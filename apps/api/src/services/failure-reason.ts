/** One short reason for the user, chosen from the FIRST failing field path
 * through a fixed table. Nothing from Zod, the prompt or the model's JSON is
 * ever copied into the text: only a path's head and a small index are read. */
export const GENERIC_SPEC_MESSAGE = 'Dữ liệu màn chơi không hợp lệ hoặc không thể chơi an toàn. Hãy đơn giản hóa mô tả rồi thử lại.';

const MAX_INDEX = 99;

export function failureReason(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const [head, rawIndex] = path.split('.');
  const index = rawIndex !== undefined && /^\d{1,2}$/.test(rawIndex) ? Number(rawIndex) : undefined;
  if (index !== undefined && index > MAX_INDEX) return undefined;
  switch (head) {
    case 'platforms':
    case 'obstacles':
      return 'Có bệ đỡ/vật cản nằm ngoài vùng chơi hoặc không thể đứng lên được.';
    case 'collectibles':
      return index === undefined ? undefined : `Xu số ${index + 1} không thể nhặt được.`;
    case 'enemies':
      return index === undefined ? undefined : `Kẻ địch số ${index + 1} đặt ở vị trí không an toàn.`;
    case 'player':
      return 'Điểm xuất phát của người chơi bị chặn.';
    case 'win':
    case 'lose':
      return 'Mục tiêu thắng/thua không thể đạt được trong màn chơi này.';
    default:
      return undefined;
  }
}

/** `<message> Lý do: <reason>`, or the message unchanged when the path has no entry. */
export function withReason(message: string, path: string | undefined): string {
  const reason = failureReason(path);
  return reason === undefined ? message : `${message} Lý do: ${reason}`;
}
