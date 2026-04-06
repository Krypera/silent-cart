alter table fulfillment_records
  drop constraint if exists fulfillment_records_status_check;

alter table fulfillment_records
  add constraint fulfillment_records_status_check
  check (status in ('pending', 'processing', 'delivered', 'failed', 'manual_review'));
