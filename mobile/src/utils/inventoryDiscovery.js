export function validInventoryEan(value) {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  const digits = [...value].map(Number), check = digits.pop();
  return (10 - digits.reverse().reduce((sum, digit, i) => sum + digit * (i % 2 === 0 ? 3 : 1), 0) % 10) % 10 === check;
}
export function addDiscoveredCountItem(lines, item, quantity) {
  const found = lines.findIndex(line => line.item_id === item.item_id);
  if (found !== -1) return lines.map((line, i) => i === found ? { ...line, counted_quantity: String((Number(line.counted_quantity) || 0) + quantity) } : line);
  return [...lines, { count_line_id: null, item_id: item.item_id, sku: item.sku, item_name: item.item_name, upc: item.upc, expected_quantity: 0, counted_quantity: String(quantity), unexpected: true }];
}
export async function findOrDiscoverCountItem(client, barcode, discover) {
  try {
    const { data } = await client.get(`/api/lookup/item/${encodeURIComponent(barcode)}`);
    if (data?.item) return data.item;
  } catch (error) {
    if (error.response?.status !== 404) throw error;
  }
  if (!validInventoryEan(barcode)) throw new Error('Scanează un EAN valid pentru identificarea unui produs nou.');
  return discover(barcode);
}
