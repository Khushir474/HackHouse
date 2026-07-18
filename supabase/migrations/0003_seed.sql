-- Fictional companies. Acme carries the planted, catchable red flags
-- (customer concentration 41%/19%, CAC payback stretched 13 -> 19mo).
insert into companies (name, stage, sector, ask_amount, pre_money, arr, arr_growth_yoy,
  gross_margin, net_burn_monthly, net_new_arr_monthly, cash_on_hand, cac, ltv,
  cac_payback_months, cac_payback_months_prior, top3_pct_arr, largest_customer_pct_arr,
  largest_customer_renewal_months, multi_year_contracts,
  cohort_m1, cohort_m6, cohort_m12, arr_proj_12mo, arr_proj_18mo)
values
  ('Acme Robotics', 'Series B', 'Industrial automation', 30000000, 170000000,
   12000000, 58, 64, 700000, 330000, 7700000, 48000, 210000,
   19, 13, 41, 19, 4, false,
   100, 88, 79, 19000000, 24500000),
  ('Nimbus Analytics', 'Series A', 'Data infrastructure', 12000000, 48000000,
   4200000, 96, 78, 250000, 260000, 6100000, 21000, 96000,
   9, 10, 22, 9, 11, true,
   100, 93, 90, 8400000, 11800000),
  ('Voltway', 'Series B', 'Fleet electrification', 25000000, 120000000,
   9000000, 44, 52, 900000, 210000, 8200000, 61000, 150000,
   16, 14, 28, 12, 8, false,
   100, 84, 71, 12600000, 15300000);

-- Calendar contacts + availability: 2 slots/day (14:00, 16:00 UTC) for the
-- next 7 days, weekends skipped, per contact.
with contacts (company_name, contact_name, contact_role) as (
  values
    ('Acme Robotics',    'Priya Nair',     'CFO'),
    ('Acme Robotics',    'Jordan Malik',   'customer_reference'),
    ('Nimbus Analytics', 'Sofia Reyes',    'CFO'),
    ('Nimbus Analytics', 'Ben Okafor',     'customer_reference'),
    ('Voltway',          'Dana Whitfield', 'CFO'),
    ('Voltway',          'Alex Kim',       'customer_reference')
), days as (
  select d::date as day
  from generate_series(current_date + 1, current_date + 7, interval '1 day') d
  where extract(dow from d) not in (0, 6)
), hours (h) as (values (14), (16))
insert into calendar_slots (company_id, contact_name, contact_role, slot_start, slot_end)
select c.id, k.contact_name, k.contact_role,
       (d.day + make_interval(hours => h.h)),
       (d.day + make_interval(hours => h.h, mins => 30))
from contacts k
join companies c on c.name = k.company_name
cross join days d
cross join hours h;
