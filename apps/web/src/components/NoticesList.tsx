import { CircleAlert } from 'lucide-react';

/** "Chưa hỗ trợ / điều chỉnh": what the engine could not do or changed, one sentence each. Nothing when there is none. */
export function NoticesList({ notices }: { notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return <section className="panel status-panel shooter-notices" role="status" aria-label="Chưa hỗ trợ và điều chỉnh">
    <div className="status-heading"><CircleAlert size={14}/><h2>Chưa hỗ trợ / điều chỉnh</h2></div>
    <ul>
      {notices.map((notice) => <li key={notice}>{notice}</li>)}
    </ul>
  </section>;
}
