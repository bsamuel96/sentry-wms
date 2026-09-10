export function canResumeAssignedBatch(order, user) {
  if (!order?.active_batch_id) return true;

  const assignedTo = String(order.active_batch_assigned_to || '').trim();
  if (!assignedTo) return true;

  const role = String(user?.role || '').trim().toUpperCase();
  if (role === 'ADMIN') return true;

  return assignedTo === String(user?.username || '').trim();
}
