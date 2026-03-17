import { useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { useNotificationsQuery } from "@/features/notifications/useNotificationsQuery";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const notificationsQuery = useNotificationsQuery(5);

  const label = useMemo(() => {
    if (notificationsQuery.isPending) {
      return "Notifications loading";
    }

    if (notificationsQuery.isError) {
      return "Notifications unavailable";
    }

    return `Notifications (${notificationsQuery.data?.notifications.length ?? 0})`;
  }, [notificationsQuery.data?.notifications.length, notificationsQuery.isError, notificationsQuery.isPending]);

  return (
    <div className="notification-root">
      <button
        aria-expanded={open}
        aria-label={label}
        className="button button--secondary"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        Notifications
      </button>
      {open ? (
        <div className="notification-panel">
          {notificationsQuery.isPending ? (
            <LoadingState title="Loading notifications" message="Fetching recent upload activity." compact />
          ) : notificationsQuery.isError ? (
            <ErrorState title="Notifications unavailable" message="The latest upload feed could not be loaded." compact />
          ) : notificationsQuery.data.notifications.length === 0 ? (
            <EmptyState title="No recent uploads" message="Newly uploaded files will appear here." compact />
          ) : (
            <ul className="notification-list">
              {notificationsQuery.data.notifications.map((notification) => (
                <li className="notification-item" key={notification.id}>
                  <strong>{notification.title}</strong>
                  <p>{notification.description}</p>
                  <p className="helper-text">{notification.relative_time}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
