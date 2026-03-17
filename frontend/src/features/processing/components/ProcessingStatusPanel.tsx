interface ProcessingStatusPanelProps {
  status:
    | {
        tone: "pending" | "success" | "error";
        message: string;
        compatibilityStatus?: string;
        derivedFilename?: string | null;
      }
    | null;
}

export function ProcessingStatusPanel({ status }: ProcessingStatusPanelProps) {
  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>Structuring processing</h2>
        <span className="helper-text">Use Run structuring from a file row. Polling uses the current compatibility status contract only.</span>
      </div>

      {status ? (
        <div className={`status-banner status-banner--${status.tone}`}>
          <strong>{status.message}</strong>
          {status.compatibilityStatus ? (
            <div className="helper-text">Compatibility status: {status.compatibilityStatus}</div>
          ) : null}
          {status.derivedFilename ? (
            <div className="helper-text">Derived file: {status.derivedFilename}</div>
          ) : null}
        </div>
      ) : (
        <div className="helper-text">
          No structuring job has been started from this frontend session yet.
        </div>
      )}
    </section>
  );
}
