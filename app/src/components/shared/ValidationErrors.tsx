interface ValidationErrorsProps {
  errors: Array<{ path: string; message: string }>;
}

export function ValidationErrors({ errors }: ValidationErrorsProps) {
  if (errors.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {errors.map((err, i) => (
        <p key={i} className="text-xs text-destructive">
          {err.path ? `${err.path}: ` : ""}
          {err.message}
        </p>
      ))}
    </div>
  );
}
