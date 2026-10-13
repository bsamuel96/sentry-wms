-- Backfill items.viscosity for the oils already in stock (Oct 2026).
-- Their TecDoc discoveries were saved without criteria, so the offline
-- name/payload backfill cannot see the grade. Values come from TecDoc
-- "Clasa de vascozitate conform SAE" (or the "SAE xW-yy" trade reference)
-- looked up by brand + article number. Only NULL rows are touched.

UPDATE items AS i
   SET viscosity = v.viscosity,
       updated_at = NOW()
  FROM (VALUES
        ('18aa209a-f66f-4d68-a7c9-39b409fb6297', '5W-40'),  -- CASTROL · ulei de motor 15F816
        ('6201e30f-50de-4410-9a53-4d7ca3736fa2', '10W-40'),  -- LIQUI MOLY · ulei de motor 2626
        ('62b68242-57f3-4806-8754-d7bdd30e5fca', '5W-30'),  -- CASTROL · ulei de motor 15F6E4
        ('866702ff-a9e4-4f7a-8762-785dc840e37c', '10W-40'),  -- CASTROL · ulei de motor 15F7CE
        ('bce0be88-eb6c-41b3-b487-0e89547fc9ba', '10W-40'),  -- CASTROL · ulei de motor 15F8FE
        ('c94377f3-8220-4735-82c5-c2c766532591', '10W-40'),  -- CASTROL · ulei de motor 15F7CA
        ('d29d2da3-0093-46a3-a562-795f67b15425', '5W-30'),  -- MOTUL · ulei de motor 106377
        ('d2bd3fc0-a961-4a8e-9943-3a4fefa0df70', '5W-30'),  -- ULEI RENAULT GTX RNSPEC 5W30 RN17 5L 7711943681
        ('e17c61e6-bee2-4f85-81a3-d6411a76892f', '5W-30'),  -- CASTROL · ulei de motor 15F7DA
        ('f4068b4c-65c2-4bdd-a01f-03518c09e796', '10W-40')  -- SCT - MANNOL · ulei de motor MN7501-1
  ) AS v(external_id, viscosity)
 WHERE i.external_id::text = v.external_id
   AND i.viscosity IS NULL;
