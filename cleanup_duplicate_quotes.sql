-- ============================================================
-- Ciflux OMS — Duplicate Quote Cleanup Script
-- Run ONCE after deploying the Bug 1 fix.
-- Safe to run on SQLite (the Ciflux database format).
--
-- What this does:
--   1. Identifies quote chains (root + superseded duplicates)
--   2. Merges useful fields from latest revision into root
--   3. Re-points quote_history to the root
--   4. Re-points orders.quote_id / orders.quote_no to the root
--   5. Deletes the superseded duplicate rows
--
-- ALWAYS TAKE A BACKUP BEFORE RUNNING.
-- ============================================================

-- ── STEP 0: Backup check ─────────────────────────────────────
-- Before running, verify what duplicates exist:
SELECT
  q_root.quote_no      AS root_quote,
  q_root.id            AS root_id,
  q_root.status        AS root_status,
  q_dup.quote_no       AS duplicate_quote,
  q_dup.id             AS duplicate_id,
  q_dup.status         AS duplicate_status,
  q_dup.revision       AS revision
FROM quotes q_dup
JOIN quotes q_root ON q_dup.parent_quote_id = q_root.id
WHERE q_dup.status IN ('superseded','returned_to_sourcing','active')
  AND q_dup.parent_quote_id IS NOT NULL
ORDER BY q_root.quote_no, q_dup.revision;

-- ── STEP 1: Merge latest revision data into root quote ───────
-- For each root quote, pull the best available data from
-- the most recent child and write it back to the root.
UPDATE quotes AS root
SET
  -- Carry forward zoho_po_no if root is empty
  zoho_quote_no = COALESCE(
    NULLIF(root.zoho_quote_no, ''),
    (SELECT NULLIF(child.zoho_quote_no,'')
     FROM quotes child
     WHERE child.parent_quote_id = root.id
     ORDER BY child.revision DESC LIMIT 1)
  ),
  -- Carry forward file_ref if root is empty
  file_ref = COALESCE(
    NULLIF(root.file_ref, ''),
    (SELECT NULLIF(child.file_ref,'')
     FROM quotes child
     WHERE child.parent_quote_id = root.id
     ORDER BY child.revision DESC LIMIT 1)
  ),
  -- Carry forward valid_until if root is empty
  valid_until = COALESCE(
    NULLIF(root.valid_until, ''),
    (SELECT NULLIF(child.valid_until,'')
     FROM quotes child
     WHERE child.parent_quote_id = root.id
     ORDER BY child.revision DESC LIMIT 1)
  ),
  -- Carry forward customer_response from latest child
  customer_response = COALESCE(
    root.customer_response,
    (SELECT child.customer_response
     FROM quotes child
     WHERE child.parent_quote_id = root.id
       AND child.customer_response IS NOT NULL
     ORDER BY child.revision DESC LIMIT 1)
  ),
  customer_response_date = COALESCE(
    root.customer_response_date,
    (SELECT child.customer_response_date
     FROM quotes child
     WHERE child.parent_quote_id = root.id
       AND child.customer_response_date IS NOT NULL
     ORDER BY child.revision DESC LIMIT 1)
  ),
  customer_response_notes = COALESCE(
    root.customer_response_notes,
    (SELECT child.customer_response_notes
     FROM quotes child
     WHERE child.parent_quote_id = root.id
       AND child.customer_response_notes IS NOT NULL
     ORDER BY child.revision DESC LIMIT 1)
  ),
  -- Set revision to highest seen across the chain
  revision = (
    SELECT MAX(child.revision)
    FROM quotes child
    WHERE child.parent_quote_id = root.id
  ),
  -- Set status to the latest child's status
  -- (active = back in quote bin, returned_to_sourcing = with sourcing)
  status = (
    SELECT child.status
    FROM quotes child
    WHERE child.parent_quote_id = root.id
    ORDER BY child.revision DESC LIMIT 1
  ),
  -- Carry latest sales_revision_notes
  sales_revision_notes = (
    SELECT child.sales_revision_notes
    FROM quotes child
    WHERE child.parent_quote_id = root.id
      AND child.sales_revision_notes IS NOT NULL
      AND child.sales_revision_notes != ''
    ORDER BY child.revision DESC LIMIT 1
  )
WHERE root.parent_quote_id IS NULL
  AND EXISTS (
    SELECT 1 FROM quotes child WHERE child.parent_quote_id = root.id
  );

-- ── STEP 2: Re-point quote_history to root ───────────────────
UPDATE quote_history
SET quote_id = (
  SELECT parent_quote_id
  FROM quotes
  WHERE quotes.id = quote_history.quote_id
    AND quotes.parent_quote_id IS NOT NULL
)
WHERE quote_id IN (
  SELECT id FROM quotes WHERE parent_quote_id IS NOT NULL
);

-- ── STEP 3: Re-point orders.quote_id to root ─────────────────
UPDATE orders
SET
  quote_id = (
    SELECT parent_quote_id
    FROM quotes
    WHERE quotes.id = orders.quote_id
      AND quotes.parent_quote_id IS NOT NULL
  ),
  quote_no = (
    SELECT root.quote_no
    FROM quotes root
    JOIN quotes child ON child.parent_quote_id = root.id
    WHERE child.id = orders.quote_id
    LIMIT 1
  )
WHERE quote_id IN (
  SELECT id FROM quotes WHERE parent_quote_id IS NOT NULL
);

-- ── STEP 4: Delete superseded duplicate rows ─────────────────
DELETE FROM quotes
WHERE parent_quote_id IS NOT NULL
  AND status IN ('superseded', 'active', 'returned_to_sourcing');

-- ── STEP 5: Verify result ─────────────────────────────────────
-- Should return 0 rows if cleanup was successful:
SELECT id, quote_no, status, parent_quote_id
FROM quotes
WHERE parent_quote_id IS NOT NULL;

-- Final state — should show clean single rows per enquiry:
SELECT quote_no, status, revision, zoho_quote_no, customer_response
FROM quotes
ORDER BY created_at DESC
LIMIT 20;
