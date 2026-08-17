-- Remove direct-pay test rows seeded during the pivot build.
delete from public.requests where pay_code in ('LQ-TEST01','LQ-CONF7');
