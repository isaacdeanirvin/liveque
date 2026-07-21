#!/usr/bin/env bash
# LiveQue test -> live cutover.
#
#   ./scripts/golive.sh
#
# Run it as a FILE, not by pasting its contents into a prompt. The shebang forces
# bash, which is why this works where a pasted `read -s -p` fails: that is bash
# syntax and the default macOS shell is zsh, where -p means something else
# entirely and silently returns an empty string.
#
# Secrets are read with echo off, sanitised, written to a 0600 temp file, handed
# to the CLI via --env-file, and shredded. They are never passed as command
# arguments (visible in `ps`), never printed, and never enter shell history.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_REF="jttswydixqeyyqvcohnq"
cd "$REPO" || exit 1

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
red()  { printf "\033[31m%s\033[0m\n" "$1"; }
grn()  { printf "\033[32m%s\033[0m\n" "$1"; }
yel()  { printf "\033[33m%s\033[0m\n" "$1"; }

TMP=""
cleanup() {
  [ -n "$TMP" ] && [ -f "$TMP" ] && { : > "$TMP"; rm -f "$TMP"; }
  stty echo 2>/dev/null
}
trap cleanup EXIT INT TERM

# Strip bracketed-paste wrappers (ESC[200~ / ESC[201~), any other escape
# sequence, CR, and surrounding whitespace. This is the exact failure that
# produced a bogus NO MATCH when comparing the publishable key by hand: the
# terminal's paste markers were being hashed along with the key.
sanitise() {
  printf '%s' "$1" \
    | LC_ALL=C sed -e 's/\x1b\[20[01]~//g' -e 's/\x1b\[[0-9;]*[a-zA-Z]//g' \
    | tr -d '\r\n\t '
}

# Read a secret with echo off, sanitise, and validate against a prefix + minimum
# length. Retries rather than proceeding with something malformed, because a
# half-pasted key produces a live outage that looks exactly like a code bug.
read_secret() {
  local label="$1" prefix="$2" minlen="$3" __out="$4"
  local raw clean
  while :; do
    printf "  %s (starts %s): " "$label" "$prefix"
    stty -echo 2>/dev/null
    IFS= read -r raw
    stty echo 2>/dev/null
    printf "\n"
    clean="$(sanitise "$raw")"
    if [ -z "$clean" ]; then
      red "    nothing captured - paste again"; continue
    fi
    if [[ "$clean" != "$prefix"* ]]; then
      red "    that does not start with $prefix (got ${clean:0:8}...) - paste again"; continue
    fi
    if [ "${#clean}" -lt "$minlen" ]; then
      red "    only ${#clean} chars, expected at least $minlen - truncated paste, try again"; continue
    fi
    if [[ ! "$clean" =~ ^[A-Za-z0-9_]+$ ]]; then
      red "    contains unexpected characters - paste again"; continue
    fi
    grn "    got ${#clean} chars, starts ${clean:0:8}"
    printf -v "$__out" '%s' "$clean"
    return 0
  done
}

digest_of() {
  supabase secrets list --project-ref "$PROJECT_REF" 2>/dev/null \
    | python3 -c "
import json,sys
try: rows=json.load(sys.stdin)['secrets']
except Exception: raise SystemExit
print(next((r['value'] for r in rows if r['name']==sys.argv[1]), ''))
" "$1"
}

bold "LiveQue go-live"
echo
yel "Do these in the Stripe DASHBOARD first. This script cannot do them for you."
cat <<'EOF'

  1. Business verification complete.
     Live keys are rejected until this clears, and it can take days.
     dashboard.stripe.com  ->  the activation checklist

  2. Payment method domains registered in LIVE mode. BOTH of these, separately:
       getliveque.com
       www.getliveque.com
     Settings -> Payment method domains
     Skip this and cards still work, but Apple Pay and Google Pay silently
     vanish. No error appears anywhere.

  3. TWO live webhook endpoints, both pointing at:
       https://jttswydixqeyyqvcohnq.supabase.co/functions/v1/stripe-webhook

     a) a normal endpoint subscribed to:
          payment_intent.succeeded
          charge.dispute.created

     b) an endpoint SCOPED TO CONNECTED ACCOUNTS subscribed to:
          account.updated
        This one is not optional. It is what marks a performer ready the moment
        their verification clears. A normal endpoint will not deliver it.

     Copy the signing secret from (a). It is a NEW whsec_, different from test.

EOF
printf "All three done? [y/N] "; read -r ok
case "$ok" in y|Y|yes|YES) ;; *) yel "Stopping. Nothing changed."; exit 0;; esac

echo
bold "Step 1 of 2 - webhook signing secret"
echo "  This goes first on purpose. A live signing secret with no live traffic is"
echo "  harmless; live keys with a stale secret drops every event silently."
echo
echo "  There are TWO webhook endpoints, each with its OWN signing secret:"
echo "    1. the normal one          (Your account: payments, disputes)"
echo "    2. the connected-accounts one (account.updated)"
echo "  Both point at the same function, so it must know both secrets or the"
echo "  second endpoint's events all fail signature checks. Copy each whsec_ from"
echo "  its own page: dashboard.stripe.com/workbench/webhooks -> the endpoint -> Signing secret."
echo
WHSEC=""; read_secret "Webhook 1 (Your account) signing secret" "whsec_" 32 WHSEC
WHSEC_CONNECT=""; read_secret "Webhook 2 (Connected accounts) signing secret" "whsec_" 32 WHSEC_CONNECT

TMP="$(mktemp -t liveque-golive)"; chmod 600 "$TMP"
printf 'STRIPE_WEBHOOK_SECRET=%s\nSTRIPE_WEBHOOK_SECRET_CONNECT=%s\n' "$WHSEC" "$WHSEC_CONNECT" > "$TMP"
if supabase secrets set --env-file "$TMP" --project-ref "$PROJECT_REF" >/dev/null 2>&1; then
  grn "  both webhook secrets set"
else
  red "  FAILED to set webhook secrets"; exit 1
fi
: > "$TMP"

echo
bold "Step 2 of 2 - both API keys together"
echo "  Both in one write. A pk_live client cannot confirm a PaymentIntent that"
echo "  an sk_test created, so a half-swap breaks every payment."
echo
SK=""; read_secret "Live SECRET key"      "sk_live_" 32 SK
PK=""; read_secret "Live PUBLISHABLE key" "pk_live_" 32 PK

BEFORE_SK="$(digest_of STRIPE_SECRET_KEY)"
BEFORE_PK="$(digest_of STRIPE_PUBLISHABLE_KEY)"

printf 'STRIPE_SECRET_KEY=%s\nSTRIPE_PUBLISHABLE_KEY=%s\n' "$SK" "$PK" > "$TMP"
if supabase secrets set --env-file "$TMP" --project-ref "$PROJECT_REF" >/dev/null 2>&1; then
  grn "  both API keys set"
else
  red "  FAILED to set API keys"; exit 1
fi
: > "$TMP"; rm -f "$TMP"; TMP=""
unset SK PK WHSEC WHSEC_CONNECT

echo
bold "Verifying"
AFTER_SK="$(digest_of STRIPE_SECRET_KEY)"
AFTER_PK="$(digest_of STRIPE_PUBLISHABLE_KEY)"
[ -n "$AFTER_SK" ] && [ "$AFTER_SK" != "$BEFORE_SK" ] && grn "  secret key changed" \
  || red "  secret key digest did not change - the write did not land"
[ -n "$AFTER_PK" ] && [ "$AFTER_PK" != "$BEFORE_PK" ] && grn "  publishable key changed" \
  || red "  publishable key digest did not change - the write did not land"

cat <<'EOF'

Next, and this is the part only the performers can do.

Run this in the Supabase SQL editor. It contains no secrets. It marks everyone
as not-yet-set-up so the app stops advertising tip buttons that cannot work:

    update artist_settings set stripe_charges_enabled = false;
    update artists set stripe_onboarded = false, stripe_account_id = null;

Then every performer opens getliveque.com, logs in, and taps Set Up Payouts.
Their old account id was test-mode and does not exist under live keys. The app
now detects that and mints a fresh one automatically, so they just onboard again.

When at least one performer is through, verify with a REAL card, off-peak, not
during a gig:

    ./scripts/preflight.sh

and confirm all five:
    1. the payment succeeds
    2. the song appears in the queue      (webhook delivered)
    3. the transfer lands on the performer
    4. the platform nets about zero       (application fee ~= Stripe fee)
    5. Apple Pay shows up on a real iPhone

Rollback is config-only: put the three test values back with
`supabase secrets set`, and disable rather than delete the live webhook endpoint.

EOF
grn "Keys are live. Nothing takes real money until a performer re-onboards."
