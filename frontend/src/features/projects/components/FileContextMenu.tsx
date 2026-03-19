import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  ArrowDownToLine,
  BookCheck,
  ChevronRight,
  FileCode,
  FileOutput,
  FilePen,
  Languages,
  Layers,
  LogIn,
  LogOut,
  Play,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";

import { useProcessingJob } from "@/features/processing/useProcessingJob";
import type { FileRecord } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MenuAnchor =
  | { type: "element"; el: HTMLElement }
  | { type: "cursor"; x: number; y: number };

export interface FileContextMenuProps {
  file: FileRecord;
  projectId: number;
  chapterId: number;
  anchor: MenuAnchor;
  onClose: () => void;
  onCheckout: () => void;
  onCancelCheckout: () => void;
  onDelete: () => void;
  onOpenReferenceCheck: () => void;
}

// ─── Position helper ──────────────────────────────────────────────────────────

function computeMenuStyle(anchor: MenuAnchor): React.CSSProperties {
  const MARGIN = 16;
  const MAX_CAP = 400;

  if (anchor.type === "element") {
    const rect = anchor.el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    const openUpward = spaceAbove > spaceBelow;
    const maxHeight = Math.min(openUpward ? spaceAbove : spaceBelow, MAX_CAP);

    return {
      position: "fixed",
      right: window.innerWidth - rect.right,
      maxHeight,
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4, top: "auto" }
        : { top: rect.bottom + 4, bottom: "auto" }),
    };
  }

  const spaceBelow = window.innerHeight - anchor.y - MARGIN;
  const spaceAbove = anchor.y - MARGIN;
  const openUpward = spaceAbove > spaceBelow;
  const maxHeight = Math.min(openUpward ? spaceAbove : spaceBelow, MAX_CAP);
  const left = Math.min(anchor.x, window.innerWidth - 248);

  return {
    position: "fixed",
    left,
    maxHeight,
    ...(openUpward
      ? { bottom: window.innerHeight - anchor.y + 2, top: "auto" }
      : { top: anchor.y + 2, bottom: "auto" }),
  };
}

// ─── Shared item styles ───────────────────────────────────────────────────────

const ITEM_BASE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "7px 12px",
  fontSize: "13px",
  color: "#1A1714",
  width: "100%",
  background: "none",
  border: "none",
  textAlign: "left",
  textDecoration: "none",
  cursor: "pointer",
  lineHeight: 1.4,
};

const ICON: React.CSSProperties = { width: "15px", height: "15px", color: "#6B6560", flexShrink: 0 };
const ICON_GOLD: React.CSSProperties = { ...ICON, color: "#C9821A" };
const ICON_RED: React.CSSProperties = { ...ICON, color: "#B91C1C" };

// ─── Primitive item components ────────────────────────────────────────────────

function MenuItem({
  icon: Icon,
  label,
  iconStyle = ICON,
  isDestructive = false,
  disabled = false,
  soon = false,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  iconStyle?: React.CSSProperties;
  isDestructive?: boolean;
  disabled?: boolean;
  soon?: boolean;
  onClick?: () => void;
}) {
  const [hov, setHov] = useState(false);

  if (disabled) {
    return (
      <div
        style={{ ...ITEM_BASE, color: "#A09B96", cursor: "not-allowed", opacity: 0.55 }}
        role="menuitem"
        aria-disabled
      >
        <Icon style={{ ...iconStyle, color: "#A09B96" }} aria-hidden />
        <span style={{ flex: 1 }}>{label}</span>
        {soon && (
          <span
            style={{
              fontSize: "10px",
              color: "#A09B96",
              backgroundColor: "#F0EBE4",
              padding: "1px 6px",
              borderRadius: "4px",
            }}
          >
            Soon
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      style={{
        ...ITEM_BASE,
        color: isDestructive ? "#B91C1C" : "#1A1714",
        backgroundColor: hov ? (isDestructive ? "#FEE2E2" : "#F5F4F1") : "transparent",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
    >
      <Icon style={isDestructive ? ICON_RED : iconStyle} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

function MenuLinkItem({
  icon: Icon,
  label,
  to,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  to: string;
  onClick?: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <Link
      to={to}
      role="menuitem"
      style={{ ...ITEM_BASE, backgroundColor: hov ? "#F5F4F1" : "transparent" }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
    >
      <Icon style={ICON} aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

function MenuDownloadItem({
  icon: Icon,
  label,
  href,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
  onClick?: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <a
      href={href}
      download
      role="menuitem"
      style={{ ...ITEM_BASE, backgroundColor: hov ? "#F5F4F1" : "transparent" }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
    >
      <Icon style={ICON} aria-hidden />
      <span>{label}</span>
    </a>
  );
}

function MenuGroupLabel({ label }: { label: string }) {
  return (
    <p
      style={{
        fontSize: "11px",
        fontWeight: 500,
        color: "#A09B96",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        padding: "6px 12px 4px",
        margin: 0,
        position: "sticky",
        top: 0,
        backgroundColor: "#FFFFFF",
        zIndex: 1,
      }}
    >
      {label}
    </p>
  );
}

function MenuSeparator() {
  return (
    <hr
      style={{ border: "none", borderTop: "1px solid #F0EBE4", margin: "3px 8px" }}
      role="separator"
    />
  );
}

// ─── FileContextMenu ──────────────────────────────────────────────────────────

export function FileContextMenu({
  file,
  projectId,
  chapterId,
  anchor,
  onClose,
  onCheckout,
  onCancelCheckout,
  onDelete,
  onOpenReferenceCheck,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const processingJob = useProcessingJob({ fileId: file.id, projectId, chapterId });

  const [confirmStep, setConfirmStep] = useState<{
    processType: string;
    mode: string;
    actionName: string;
  } | null>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const menuStyle = computeMenuStyle(anchor);

  // Close on outside mousedown
  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (confirmStep) {
          setConfirmStep(null);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, confirmStep]);

  // Close on scroll / resize
  useEffect(() => {
    function handleScroll(e: Event) {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function handleResize() { onClose(); }
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [onClose]);

  const hasCheckout = file.available_actions.includes("checkout");
  const hasCancelCheckout = file.available_actions.includes("cancel_checkout");
  const hasTechnicalEdit = file.available_actions.includes("technical_edit");
  const hasStructuringReview = file.available_actions.includes("structuring_review");

  if (!mounted) return null;

  const containerStyle: React.CSSProperties = {
    ...menuStyle,
    zIndex: 9999,
    width: "240px",
    backgroundColor: "#FFFFFF",
    border: "1px solid #E2DDD6",
    borderRadius: "8px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
    padding: "4px 0",
    overflowY: "auto",
    overflowX: "hidden",
    scrollbarWidth: "thin",
    scrollbarColor: "#D1CBC3 transparent",
  };

  return createPortal(
    <>
      <style>{`
        .fcm-scroll::-webkit-scrollbar { width: 4px; }
        .fcm-scroll::-webkit-scrollbar-thumb { background-color: #D1CBC3; border-radius: 4px; }
        .fcm-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      <div
        ref={menuRef}
        role="menu"
        aria-label={`File actions for ${file.filename}`}
        className="fcm-scroll"
        style={containerStyle as React.CSSProperties}
      >
        {/* ── Confirmation step ─────────────────────────────── */}
        {confirmStep !== null ? (
          <div style={{ padding: "12px" }}>
            <p style={{ fontSize: "12px", color: "#6B6560", marginBottom: "6px" }}>
              {confirmStep.actionName} on:
            </p>
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "12px",
                color: "#1A1714",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginBottom: "12px",
              }}
              title={file.filename}
            >
              {file.filename}
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setConfirmStep(null)}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  fontSize: "13px",
                  color: "#6B6560",
                  backgroundColor: "#F5F4F1",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const { processType, mode, actionName: _ } = confirmStep;
                  setConfirmStep(null);
                  onClose();
                  void processingJob.startJob(processType, mode);
                }}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  fontSize: "13px",
                  color: "#FFFFFF",
                  backgroundColor: "#C9821A",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                Confirm
                <ChevronRight size={13} aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Group 1: Primary actions ─────────────────────────── */}
            <MenuLinkItem
              icon={FilePen}
              label="Edit in Browser"
              to={uiPaths.fileEditor(projectId, chapterId, file.id)}
              onClick={onClose}
            />
            <MenuDownloadItem
              icon={ArrowDownToLine}
              label="Download"
              href={`/api/v2/files/${file.id}/download`}
              onClick={onClose}
            />
            {hasStructuringReview && (
              <MenuLinkItem
                icon={Layers}
                label="View Structuring Review"
                to={uiPaths.structuringReview(projectId, chapterId, file.id)}
                onClick={onClose}
              />
            )}

            {/* ── Group 2: Processing ─────────────────────────────── */}
            <MenuSeparator />
            <MenuGroupLabel label="Processing" />

            <MenuItem
              icon={Play}
              label="Run All Processes"
              iconStyle={ICON_GOLD}
              disabled
              soon
            />
            <MenuItem
              icon={Layers}
              label="Structuring"
              iconStyle={ICON_GOLD}
              onClick={() => setConfirmStep({ processType: "structuring", mode: "style", actionName: "Structuring" })}
            />
            <MenuItem
              icon={Languages}
              label="Language Edit"
              onClick={() => setConfirmStep({ processType: "language", mode: "style", actionName: "Language Edit" })}
            />
            {hasTechnicalEdit ? (
              <MenuLinkItem
                icon={Wrench}
                label="Technical Edit"
                to={uiPaths.technicalReview(projectId, chapterId, file.id)}
                onClick={onClose}
              />
            ) : (
              <MenuItem icon={Wrench} label="Technical Edit" disabled />
            )}
            <MenuItem
              icon={BookCheck}
              label="Reference Check"
              onClick={() => { onClose(); onOpenReferenceCheck(); }}
            />
            <MenuItem
              icon={FileOutput}
              label="PPD Generation"
              onClick={() => setConfirmStep({ processType: "ppd", mode: "style", actionName: "PPD Generation" })}
            />
            <MenuItem
              icon={ShieldCheck}
              label="Permissions Check"
              onClick={() => setConfirmStep({ processType: "permissions", mode: "style", actionName: "Permissions Check" })}
            />
            <MenuItem
              icon={Sparkles}
              label="AI Credit Extraction"
              onClick={() => setConfirmStep({ processType: "credit_extractor_ai", mode: "style", actionName: "AI Credit Extraction" })}
            />
            <MenuItem
              icon={ScanLine}
              label="Bias Scan"
              onClick={() => setConfirmStep({ processType: "bias_scan", mode: "style", actionName: "Bias Scan" })}
            />
            <MenuItem
              icon={FileCode}
              label="Word to XML"
              onClick={() => setConfirmStep({ processType: "word_to_xml", mode: "style", actionName: "Word to XML" })}
            />

            {/* ── Group 3: Checkout & Delete ─────────────────────── */}
            <MenuSeparator />
            <MenuGroupLabel label="Checkout" />

            {hasCheckout && (
              <MenuItem
                icon={LogOut}
                label="Check Out"
                onClick={() => { onClose(); onCheckout(); }}
              />
            )}
            {hasCancelCheckout && (
              <MenuItem
                icon={LogIn}
                label="Release Lock"
                onClick={() => { onClose(); onCancelCheckout(); }}
              />
            )}
            {!hasCheckout && !hasCancelCheckout && (
              <MenuItem icon={LogOut} label="Check Out" disabled />
            )}
            <MenuItem
              icon={Trash2}
              label="Delete"
              isDestructive
              onClick={() => { onClose(); onDelete(); }}
            />

            {/* Scroll fade */}
            <div
              aria-hidden
              style={{
                position: "sticky",
                bottom: 0,
                height: "24px",
                background: "linear-gradient(to bottom, transparent, #FFFFFF)",
                pointerEvents: "none",
              }}
            />
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
