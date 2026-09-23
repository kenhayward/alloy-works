import { contentDocumentSchema, type Alternative } from '@alloy-works/domain';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import type { UploadOutcome } from './upload.js';

/** The language rule a component's own base language is held to, which an asset's is too. */
const languageTag = contentDocumentSchema.shape.language;

export interface FigureDialogProps {
  /** `Figure` to make one, `Replace image` to give an existing one another. */
  readonly title: 'Figure' | 'Replace image';
  /** The language a description is in unless the author says otherwise: the component's. */
  readonly language: string;
  /** Uploads the bytes with the description given, or none, and says what came of it. */
  readonly upload: (
    bytes: Uint8Array,
    alternative: { readonly text: string; readonly language: string } | null,
  ) => Promise<UploadOutcome>;
  /**
   * The asset version made, and how the figure's alternative text is given as a result; answers why
   * it could not be placed, which the dialog says and stays open for, or null once it has been.
   */
  readonly onDone: (result: {
    readonly assetVersion: string;
    readonly alternative: Alternative;
  }) => string | null;
  readonly onCancel: () => void;
}

/**
 * The Figure dialog (figures 2, ruling R4): one image, and **either** a description in a language or
 * **It is decorative** - the model has no state for "not yet described", and the moment of choosing
 * the picture is when the author knows what it shows (decision F-P). A description becomes the image's
 * own, which the figure then inherits; decorative makes the figure decorative and leaves the image
 * with none. It says _Checking the image_ while the upload is followed, and a refusal in words, and
 * closes only once there is an image to place.
 */
export function FigureDialog({ title, language, upload, onDone, onCancel }: FigureDialogProps) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState(language);
  const [decorative, setDecorative] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement | null>(null);

  useEffect(() => first.current?.focus(), []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onCancel();
    }
  };

  const submit = async () => {
    if (busy) return;
    if (file === null) {
      setSaid('Choose an image, a PNG or a JPEG.');
      return;
    }
    const text = description.trim();
    if (!decorative && text === '') {
      setSaid('Describe the image, or say it is decorative.');
      return;
    }
    const language = tag.trim();
    if (!decorative && !languageTag.safeParse(language).success) {
      setSaid('Give the language as a tag, such as en-GB.');
      return;
    }
    setBusy(true);
    setSaid(null);
    let outcome: UploadOutcome;
    try {
      outcome = await upload(
        new Uint8Array(await file.arrayBuffer()),
        decorative ? null : { text, language },
      );
    } finally {
      setBusy(false);
    }
    if (!outcome.ok) {
      setSaid(outcome.sentence);
      return;
    }
    setSaid(
      onDone({
        assetVersion: outcome.assetVersion,
        alternative: decorative ? { kind: 'decorative' } : { kind: 'inherited' },
      }),
    );
  };

  return (
    <div className={shell['scrim']}>
      <div
        className={shell['dialog']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        aria-busy={busy}
        onKeyDown={onKeyDown}
      >
        <form
          className={styles['form']}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2 id={`${id}-heading`} className={styles['heading']}>
            <span className={styles['tile']} aria-hidden="true">
              <Icon name="Figure" size={22} />
            </span>
            {title}
          </h2>
          <div className={styles['field']}>
            <label htmlFor={`${id}-image`}>Image</label>
            <input
              id={`${id}-image`}
              ref={first}
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className={styles['field']}>
            <label htmlFor={`${id}-description`}>Description</label>
            <textarea
              id={`${id}-description`}
              value={description}
              disabled={decorative}
              aria-describedby={`${id}-description-hint`}
              onChange={(event) => setDescription(event.target.value)}
            />
            <p id={`${id}-description-hint`} className={styles['hint']}>
              What the image shows, for someone who cannot see it.
            </p>
          </div>
          <div className={styles['field']}>
            <label htmlFor={`${id}-language`}>Language</label>
            <input
              id={`${id}-language`}
              type="text"
              value={tag}
              disabled={decorative}
              onChange={(event) => setTag(event.target.value)}
            />
          </div>
          <label>
            <input
              type="checkbox"
              checked={decorative}
              onChange={(event) => setDecorative(event.target.checked)}
            />
            It is decorative
          </label>
          {busy && <p role="status">Checking the image</p>}
          {said !== null && (
            <p role="alert" className={styles['complaint']}>
              {said}
            </p>
          )}
          <div className={styles['footer']}>
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" aria-disabled={busy}>
              Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
