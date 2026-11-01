import {
  contentDocumentSchema,
  type Alternative,
  type DeclarableRights,
} from '@alloy-works/domain';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import type { UploadOutcome } from './upload.js';
import { imageChoices, StyleSelect } from '../theme/StyleChoice.js';
import { usePresentation } from '../theme/presentation.js';
import { words } from '../words/words.js';

/** The language rule a component's own base language is held to, which an asset's is too. */
const languageTag = contentDocumentSchema.shape.language;

export interface FigureDialogProps {
  /**
   * `Figure` to make one, `Image` to place one in a run of text (figures 4), `Replace image` to give
   * either another.
   */
  readonly title: 'Figure' | 'Image' | 'Replace image';
  /** The language a description is in unless the author says otherwise: the component's. */
  readonly language: string;
  /**
   * Uploads the bytes with the description given, or none, and the file's name and what was declared
   * of where it came from (AST-044; the AL plan, AL-E), and says what came of it.
   */
  readonly upload: (
    bytes: Uint8Array,
    alternative: { readonly text: string; readonly language: string } | null,
    declared: { readonly name?: string; readonly rights: DeclarableRights },
  ) => Promise<UploadOutcome>;
  /** The environment's licences an image may be held under, by name (AL-B). */
  readonly licences: () => Promise<readonly { readonly id: string; readonly name: string }[]>;
  /**
   * The asset version made, and how the figure's alternative text is given as a result; answers why
   * it could not be placed, which the dialog says and stays open for, or null once it has been.
   */
  readonly onDone: (result: {
    readonly assetVersion: string;
    readonly alternative: Alternative;
    /** The image style chosen for what is placed (themes.md, ET-G); none when replacing an image. */
    readonly imageStyle?: string;
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
export function FigureDialog({
  title,
  language,
  upload,
  licences,
  onDone,
  onCancel,
}: FigureDialogProps) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState(language);
  const [decorative, setDecorative] = useState(false);
  // Where it came from (AST-044): Not declared until a licence is chosen, said so, never silent.
  const [offeredLicences, setOfferedLicences] = useState<
    readonly { readonly id: string; readonly name: string }[]
  >([]);
  const [licence, setLicence] = useState('');
  const [source, setSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [expires, setExpires] = useState('');
  const [credit, setCredit] = useState('');
  // What a figure or an image in a line is placed in, from the theme's image catalogue (CNT-121):
  // the schema's default where the theme offers it, which is what was placed before there was a choice.
  const presentation = usePresentation();
  const target = title === 'Figure' ? 'figure' : title === 'Image' ? 'inlineImage' : null;
  const offered =
    presentation?.state === 'ready' && target !== null
      ? imageChoices(presentation.theme, target)
      : [];
  const [imageStyle, setImageStyle] = useState<string | null>(null);
  const placedIn =
    imageStyle ??
    offered.find((choice) => choice.value === (target === 'figure' ? 'figure' : 'inline'))?.value ??
    offered[0]?.value;
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement | null>(null);

  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    let live = true;
    void licences().then(
      (found) => live && setOfferedLicences(found),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [licences]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onCancel();
    }
  };

  const submit = async () => {
    if (busy) return;
    if (file === null) {
      setSaid(words('editor.choose-an-image-a-png'));
      return;
    }
    const text = description.trim();
    if (!decorative && text === '') {
      setSaid(words('editor.describe-the-image-or-say'));
      return;
    }
    const language = tag.trim();
    if (!decorative && !languageTag.safeParse(language).success) {
      setSaid(words('editor.give-the-language-as-a'));
      return;
    }
    if (licence !== '' && source.trim() === '') {
      setSaid(words('editor.say-where-the-image-came-from'));
      return;
    }
    const rights: DeclarableRights =
      licence === ''
        ? { kind: 'undeclared' }
        : {
            kind: 'declared',
            source: {
              text: source.trim(),
              ...(sourceUrl.trim() === '' ? {} : { url: sourceUrl.trim() }),
            },
            licence,
            ...(expires === '' ? {} : { expires }),
            ...(credit.trim() === '' ? {} : { credit: credit.trim() }),
          };
    const name = file.name.trim().slice(0, 255);
    setBusy(true);
    setSaid(null);
    let outcome: UploadOutcome;
    try {
      outcome = await upload(
        new Uint8Array(await file.arrayBuffer()),
        decorative ? null : { text, language },
        { ...(name === '' ? {} : { name }), rights },
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
        ...(placedIn === undefined ? {} : { imageStyle: placedIn }),
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
            {words(
              title === 'Figure'
                ? 'editor.figure'
                : title === 'Image'
                  ? 'editor.image'
                  : 'editor.replace-image',
            )}
          </h2>
          <div className={styles['field']}>
            <label htmlFor={`${id}-image`}>{words('editor.image')}</label>
            <input
              id={`${id}-image`}
              ref={first}
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className={styles['field']}>
            <label htmlFor={`${id}-description`}>{words('editor.description')}</label>
            <textarea
              id={`${id}-description`}
              value={description}
              disabled={decorative}
              aria-describedby={`${id}-description-hint`}
              onChange={(event) => setDescription(event.target.value)}
            />
            <p id={`${id}-description-hint`} className={styles['hint']}>
              {words('editor.what-the-image-shows-for')}
            </p>
          </div>
          <div className={styles['field']}>
            <label htmlFor={`${id}-language`}>{words('editor.language')}</label>
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
            {words('editor.it-is-decorative')}
          </label>
          <fieldset className={styles['field']}>
            <legend>{words('editor.source-and-licence')}</legend>
            <label htmlFor={`${id}-licence`}>{words('editor.licence')}</label>
            <select
              id={`${id}-licence`}
              value={licence}
              aria-describedby={licence === '' ? `${id}-licence-hint` : undefined}
              onChange={(event) => setLicence(event.target.value)}
            >
              <option value="">{words('editor.not-declared')}</option>
              {offeredLicences.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
            {licence === '' ? (
              <p id={`${id}-licence-hint`} className={styles['hint']}>
                {words('editor.an-image-with-no-licence')}
              </p>
            ) : (
              <>
                <label htmlFor={`${id}-source`}>{words('editor.source')}</label>
                <input
                  id={`${id}-source`}
                  type="text"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                />
                <label htmlFor={`${id}-source-url`}>{words('editor.source-address')}</label>
                <input
                  id={`${id}-source-url`}
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                />
                <label htmlFor={`${id}-expires`}>{words('editor.grant-last-day')}</label>
                <input
                  id={`${id}-expires`}
                  type="date"
                  value={expires}
                  onChange={(event) => setExpires(event.target.value)}
                />
                <label htmlFor={`${id}-credit`}>{words('editor.credit')}</label>
                <input
                  id={`${id}-credit`}
                  type="text"
                  value={credit}
                  onChange={(event) => setCredit(event.target.value)}
                />
              </>
            )}
          </fieldset>
          {offered.length > 0 && placedIn !== undefined && (
            <StyleSelect
              className={styles['field']}
              label={words('editor.image-style')}
              value={placedIn}
              choices={offered}
              enabled={!busy}
              onChoose={setImageStyle}
            />
          )}
          {busy && <p role="status">{words('editor.checking-the-image')}</p>}
          {said !== null && (
            <p role="alert" className={styles['complaint']}>
              {said}
            </p>
          )}
          <div className={styles['footer']}>
            <button type="button" onClick={onCancel} disabled={busy}>
              {words('editor.cancel')}
            </button>
            <button type="submit" aria-disabled={busy}>
              {words('editor.upload')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
