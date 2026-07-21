#!/usr/bin/env bash
# LiveQue go-live preflight.
#
# Read-only. Prints what is actually true right now rather than what we think
# is true. Run it before and after any test-to-live switch.
#
#   ./scripts/preflight.sh
#
# It never prints a secret value. Where it needs one it reports only presence.

set -uo pipefail

SITE="https://getliveque.com"
PROJECT_REF="jttswydixqeyyqvcohnq"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass=0; fail=0; warn=0
ok()   { printf "  \033[32m PASS \033[0m %s\n" "$1"; pass=$((pass+1)); }
no()   { printf "  \033[31m FAIL \033[0m %s\n" "$1"; fail=$((fail+1)); }
hmm()  { printf "  \033[33m ??   \033[0m %s\n" "$1"; warn=$((warn+1)); }
head_() { printf "\n\033[1m%s\033[0m\n" "$1"; }

head_ "SITE"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/")
[ "$code" = "200" ] && ok "$SITE responds 200" || no "$SITE responds $code"
ver=$(curl -s -H 'Cache-Control: no-cache' --max-time 15 "$SITE/" | grep -o 'v6\.9\.[0-9]*' | head -1)
[ -n "$ver" ] && ok "deployed version $ver" || hmm "could not read deployed version"

local_ver=$(grep -o 'v6\.9\.[0-9]*' "$REPO/index.html" | head -1)
if [ "$ver" = "$local_ver" ]; then ok "deployed matches local ($local_ver)"
else no "deployed $ver but local is $local_ver - unpushed or undeployed work"; fi

head_ "GIT"
cd "$REPO"
dirty=$(git status --porcelain | wc -l | tr -d ' ')
[ "$dirty" = "0" ] && ok "working tree clean" || no "$dirty uncommitted file(s)"
if [ "$(git rev-parse HEAD)" = "$(git ls-remote origin main 2>/dev/null | cut -f1)" ]; then
  ok "local HEAD matches origin/main"
else no "local and origin/main differ - push"; fi

head_ "APPLE PAY / GOOGLE PAY"
# NOTE: there is deliberately no /.well-known/apple-developer-merchantid-domain-association
# check here. Stripe handles Apple merchant validation itself and its current docs
# say not to follow Apple's own process. The string "well-known" does not appear
# anywhere in Stripe's current Apple Pay or payment-method-domain guides. A 404 on
# that path is EXPECTED and is not why wallet buttons fail.
#
# What actually gates the wallets is domain registration in the Stripe Dashboard,
# per mode, which cannot be read from here without a secret key.
tls=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/")
[ "$tls" = "200" ] && ok "HTTPS serving (Google Pay requires a TLS domain-validated cert)" \
                   || no "site not serving over HTTPS"
hmm "domain registration is Dashboard-only: verify getliveque.com AND www.getliveque.com"
hmm "  appear at dashboard.stripe.com/settings/payment_method_domains in LIVE mode"

head_ "EDGE FUNCTIONS"
if command -v supabase >/dev/null 2>&1; then
  fns=$(supabase functions list 2>/dev/null)
  if [ -n "$fns" ]; then
    for f in stripe-create-tip stripe-webhook stripe-status stripe-onboard liveque-email gig-recap-sweeper import-spotify; do
      if printf '%s' "$fns" | grep -q "\"slug\":\"$f\""; then ok "$f deployed"; else no "$f NOT deployed"; fi
    done
  else hmm "could not list functions (not logged in?)"; fi
else hmm "supabase CLI not installed"; fi

head_ "SECRETS (presence only, never values)"
if command -v supabase >/dev/null 2>&1; then
  secs=$(supabase secrets list 2>/dev/null)
  if [ -n "$secs" ]; then
    for s in STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY EMAIL_FROM SWEEP_SECRET; do
      printf '%s' "$secs" | grep -q "\"name\":\"$s\"" && ok "$s set" || no "$s MISSING"
    done
    # A shared digest means one value was pasted into two secret names, which is
    # how RESEND_API_KEY once ended up inside SWEEP_SECRET. Ignore the SUPABASE_*
    # names: those are injected by the platform and several legitimately hold {}.
    dup=$(printf '%s' "$secs" | python3 -c "
import json,sys
from collections import defaultdict
try: rows=json.load(sys.stdin)['secrets']
except Exception: raise SystemExit
EMPTY='44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
g=defaultdict(list)
for r in rows:
    if r['name'].startswith('SUPABASE_'): continue
    if r['value']==EMPTY: continue
    g[r['value']].append(r['name'])
print('; '.join(', '.join(v) for v in g.values() if len(v)>1))
")
    [ -z "$dup" ] && ok "no two of our secrets share a value" \
      || no "same value in: $dup - paste error, rotate both"
  else hmm "could not list secrets"; fi
fi

head_ "PERFORMER READINESS (what a fan actually sees)"
KEY=$(grep -oE "eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+" "$REPO/customer.html" | head -1)
SB="https://${PROJECT_REF}.supabase.co"
if [ -n "$KEY" ]; then
  rows=$(curl -s --max-time 20 "$SB/rest/v1/artist_settings?select=artist_id,stripe_charges_enabled" \
        -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
  names=$(curl -s --max-time 20 "$SB/rest/v1/artists?select=id,name" \
        -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
  python3 - "$rows" "$names" <<'PY'
import json,sys
try:
    rows=json.loads(sys.argv[1]); names={a['id']:a['name'] for a in json.loads(sys.argv[2])}
except Exception:
    print("  ??    could not read performer readiness"); raise SystemExit
for r in rows:
    n=names.get(r['artist_id'],r['artist_id'][:8])
    if r.get('stripe_charges_enabled'):
        print(f"  \033[32m PASS \033[0m {n}: fans CAN tip")
    else:
        print(f"  \033[31m FAIL \033[0m {n}: fans CANNOT tip (log into the dashboard to sync)")
PY
else hmm "could not find the public anon key in customer.html"; fi

head_ "LEGAL SURFACES"
for p in terms privacy help.html handbook.html; do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/$p")
  [ "$c" = "200" ] && ok "/$p live" || no "/$p returns $c"
done

printf "\n\033[1mSUMMARY\033[0m  %d pass, %d fail, %d unknown\n\n" "$pass" "$fail" "$warn"
[ "$fail" -eq 0 ] || exit 1
