-- Part A: Rule of 40 must use EBITDA margin, not gross margin (the spec demo's
-- "Rule of 40: 34" for Acme is only reproducible with EBITDA). Additive change
-- per the 0001 schema policy. Percentage points (e.g. -24 means -24%).
alter table companies add column if not exists ebitda_margin numeric;

update companies set ebitda_margin = -24 where name = 'Acme Robotics';    -- 58 - 24 = 34, below threshold (planted flag)
update companies set ebitda_margin = -8  where name = 'Nimbus Analytics'; -- 96 - 8  = 88, healthy
update companies set ebitda_margin = -2  where name = 'Voltway';          -- 44 - 2  = 42, healthy

alter table companies alter column ebitda_margin set not null;
