import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { useNotificationsQuery } from "@/features/notifications/useNotificationsQuery";
import type { NotificationItem } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

// Derive a navigation path from the notification's linked IDs.
function notificationHref(n: NotificationItem): string | null {
  if (n.project_id !== null && n.chapter_id !== null) {
    return uiPaths.chapterDetail(n.project_id, n.chapter_id);
  }
  if (n.project_id !== null) {
    return uiPaths.projectDetail(n.project_id);
  }
  return null;
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const notificationsQuery = useNotificationsQuery(5);

  const notifications = notificationsQuery.data?.notifications ?? [];

  const hasUnread = useMemo(
    () => notifications.some((n) => !readIds.has(n.id)),
    [notifications, readIds],
  );

  const buttonLabel = useMemo(() => {
    if (notificationsQuery.isPending) return "Notifications loading";
    if (notificationsQuery.isError) return "Notifications unavailable";
    return `Notifications (${notifications.length})`;
  }, [notifications.length, notificationsQuery.isError, notificationsQuery.isPending]);

  // ── Outside click ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  // ── Escape key ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  function markRead(id: string) {
    setReadIds((prev) => new Set(prev).add(id));
  }

  function markAllRead() {
    setReadIds(new Set(notifications.map((n) => n.id)));
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={buttonLabel}
        className="relative w-9 h-9 rounded-full flex items-center justify-center text-navy-600 hover:bg-surface-200 transition-colors duration-150"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
        {hasUnread && (
          <span
            aria-label="Unread notifications"
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-error-600"
          />
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          role="listbox"
          aria-label="Notifications"
          style={{ zIndex: 9999 }}
          className="absolute right-0 top-full mt-2 w-80 rounded-md bg-white shadow-modal border border-surface-300 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-200 shrink-0">
            <span className="text-xs font-semibold text-navy-500 uppercase tracking-wide">
              Notifications
            </span>
            {notifications.length > 0 && hasUnread && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-navy-400 hover:text-navy-700 transition-colors"
                aria-label="Mark all as read"
              >
                <CheckCheck size={13} aria-hidden="true" />
                Mark all read
              </button>
            )}
          </div>

          {/* Body */}
          {notificationsQuery.isPending ? (
            <div className="px-4 py-6 text-center text-sm text-navy-400">
              Loading…
            </div>
          ) : notificationsQuery.isError ? (
            <div className="px-4 py-6 text-center text-sm text-error-600">
              Could not load notifications.
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState
              size="sm"
              title="No recent uploads"
              description="Newly uploaded files will appear here."
            />
          ) : (
            <ul
              className="divide-y divide-surface-200 overflow-y-auto"
              style={{
                maxHeight: 400,
                scrollbarWidth: "thin",
                scrollbarColor: "#D1CBC3 transparent",
              }}
            >
              {notifications.map((notification) => {
                const isRead = readIds.has(notification.id);
                const href = notificationHref(notification);

                return (
                  <li
                    key={notification.id}
                    role="option"
                    aria-selected={isRead}
                    className="px-4 py-3 hover:bg-surface-50 transition-colors"
                    onClick={() => markRead(notification.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            isRead
                              ? "text-sm text-navy-400"
                              : "text-sm font-medium text-navy-900"
                          }
                        >
                          {notification.title}
                        </p>
                        <p className="text-xs text-navy-500 mt-0.5 leading-relaxed">
                          {notification.description}
                        </p>
                        <p className="text-xs text-navy-300 mt-1">
                          {notification.relative_time}
                        </p>
                      </div>
                      {href && (
                        <Link
                          to={href}
                          onClick={(e) => {
                            e.stopPropagation();
                            markRead(notification.id);
                            setIsOpen(false);
                          }}
                          className="shrink-0 text-xs text-gold-700 hover:text-gold-800 font-medium transition-colors mt-0.5"
                        >
                          View
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
