interface StructuringSaveFormProps {
  value: string;
  isPending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
}

export function StructuringSaveForm({
  value,
  isPending,
  onChange,
  onSubmit,
}: StructuringSaveFormProps) {
  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>Save changes</h2>
        <span className="helper-text">
          Submit a raw JSON object as the current backend `changes` payload.
        </span>
      </div>

      <label className="field">
        <span>Changes JSON</span>
        <textarea
          className="textarea-input"
          disabled={isPending}
          rows={10}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>

      <div className="upload-actions">
        <button className="button" disabled={isPending} type="button" onClick={() => void onSubmit()}>
          {isPending ? "Saving..." : "Save changes"}
        </button>
      </div>
    </section>
  );
}
