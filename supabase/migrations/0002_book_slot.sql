-- Atomic booking: UPDATE ... WHERE is_booked = false guarantees two
-- concurrent calls cannot both win the same slot.
create or replace function book_slot(p_slot_id uuid, p_phone text, p_purpose text)
returns setof calendar_slots
language plpgsql
as $$
declare
  won calendar_slots;
begin
  update calendar_slots
     set is_booked = true
   where id = p_slot_id and is_booked = false
   returning * into won;

  if won.id is null then
    return;  -- empty set = slot missing or already booked
  end if;

  insert into calendar_bookings (slot_id, phone_number, purpose)
  values (p_slot_id, p_phone, p_purpose);

  return next won;
end;
$$;
