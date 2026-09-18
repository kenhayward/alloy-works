export interface DirectionSelectProps {
  readonly value: 'ltr' | 'rtl';
  readonly disabled?: boolean;
  readonly onChange: (direction: 'ltr' | 'rtl') => void;
}

/**
 * The base direction, offered the same way wherever it is set - creating a component
 * (`NewComponent`) and editing one already made (`ComponentHeader`) - so the two forms cannot drift
 * apart (review round 1, item 8). The enum is the content model's own, so every value the element can
 * produce is already a valid one; there is nothing here to refuse.
 */
export function DirectionSelect({ value, disabled = false, onChange }: DirectionSelectProps) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === 'rtl' ? 'rtl' : 'ltr')}
    >
      <option value="ltr">Left to right</option>
      <option value="rtl">Right to left</option>
    </select>
  );
}
