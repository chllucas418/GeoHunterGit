-- Optimizing map_set_items lookups for Status API
CREATE INDEX IF NOT EXISTS idx_map_set_items_order ON map_set_items(set_id, order_index);
