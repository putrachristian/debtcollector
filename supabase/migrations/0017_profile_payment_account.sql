-- Saved account number for “I’m the payer” / transfer details on My debt.

alter table public.profiles
  add column if not exists payment_account_number text;
