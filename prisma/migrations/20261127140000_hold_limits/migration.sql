-- Capacity can never go negative, and a hold always takes at least one place
-- (E2-S1-02). Enforced in the database as well as in the service, so no code
-- path can oversell a slot.
ALTER TABLE "Availability"
  ADD CONSTRAINT "Availability_remaining_nonnegative" CHECK ("remaining" >= 0);

ALTER TABLE "Hold"
  ADD CONSTRAINT "Hold_quantity_positive" CHECK ("quantity" > 0);
