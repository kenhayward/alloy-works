import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FigureDialog } from './FigureDialog.js';

const STOCK = '6f1c2a4e-0b3d-4c5e-8f7a-9b0c1d2e3f40';

const png = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'harbour.png', { type: 'image/png' });

function dialog() {
  const upload = vi.fn(async () => ({ ok: true as const, assetVersion: 'v1' }));
  const onDone = vi.fn(() => null);
  render(
    <FigureDialog
      title="Figure"
      language="en-GB"
      upload={upload}
      licences={async () => [{ id: STOCK, name: 'Stock, editorial' }]}
      onDone={onDone}
      onCancel={() => undefined}
    />,
  );
  return { upload, onDone };
}

describe('the Figure dialog asks where an image came from (the AL plan, AL-E)', () => {
  it('AST-044 sends the source and licence declared, the last day of the grant and its credit, with the file name', async () => {
    const user = userEvent.setup();
    const { upload } = dialog();
    await user.upload(screen.getByLabelText('Image'), png());
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'A harbour at dawn');
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Licence' }),
      'Stock, editorial',
    );
    await user.type(screen.getByRole('textbox', { name: 'Source' }), 'A stock library');
    await user.type(
      screen.getByRole('textbox', { name: 'Address of the source' }),
      'https://stock.example/harbour',
    );
    await user.type(screen.getByLabelText('Last day of the grant'), '2027-03-31');
    await user.type(screen.getByRole('textbox', { name: 'Credit' }), 'Photograph by Ada');
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(upload).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      { text: 'A harbour at dawn', language: 'en-GB' },
      {
        name: 'harbour.png',
        rights: {
          kind: 'declared',
          source: { text: 'A stock library', url: 'https://stock.example/harbour' },
          licence: STOCK,
          expires: '2027-03-31',
          credit: 'Photograph by Ada',
        },
      },
    );
  });

  it('AST-044 records an image declared as Not declared, the choice it starts on, and says what that means', async () => {
    const user = userEvent.setup();
    const { upload } = dialog();
    expect(await screen.findByRole('combobox', { name: 'Licence' })).toHaveDisplayValue(
      'Not declared',
    );
    expect(
      screen.getByText(
        'An image with no licence declared may be reported or refused when it is published.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Source' })).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText('Image'), png());
    await user.click(screen.getByRole('checkbox', { name: 'It is decorative' }));
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(upload).toHaveBeenCalledWith(expect.any(Uint8Array), null, {
      name: 'harbour.png',
      rights: { kind: 'undeclared' },
    });
  });

  it('asks for a source once a licence is chosen, and sends nothing until it has one', async () => {
    const user = userEvent.setup();
    const { upload } = dialog();
    await user.upload(screen.getByLabelText('Image'), png());
    await user.click(screen.getByRole('checkbox', { name: 'It is decorative' }));
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Licence' }),
      'Stock, editorial',
    );
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(
      await screen.findByText('Say where the image came from, or choose Not declared.'),
    ).toBeVisible();
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps a long file name to 255 characters, never cutting one in two', async () => {
    const user = userEvent.setup();
    const { upload } = dialog();
    const smile = String.fromCodePoint(0x1f600);
    const long = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], smile.repeat(300), {
      type: 'image/png',
    });
    await user.upload(screen.getByLabelText('Image'), long);
    await user.click(screen.getByRole('checkbox', { name: 'It is decorative' }));
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(upload).toHaveBeenCalledWith(expect.any(Uint8Array), null, {
      name: smile.repeat(255),
      rights: { kind: 'undeclared' },
    });
  });

  it('asks for an https address and a source and credit it can hold, and sends nothing until it has them', async () => {
    const user = userEvent.setup();
    const { upload } = dialog();
    await user.upload(screen.getByLabelText('Image'), png());
    await user.click(screen.getByRole('checkbox', { name: 'It is decorative' }));
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Licence' }),
      'Stock, editorial',
    );
    await user.type(screen.getByRole('textbox', { name: 'Source' }), 'A stock library');
    const address = screen.getByRole('textbox', { name: 'Address of the source' });
    await user.type(address, 'http://stock.example/harbour');
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(
      await screen.findByText('Give the address of the source as an https address, or none.'),
    ).toBeVisible();
    await user.clear(address);
    // Typed by the field's own limit; pasted, a longer one is said so.
    const credit = screen.getByRole('textbox', { name: 'Credit' });
    expect(credit).toHaveAttribute('maxlength', '500');
    expect(screen.getByRole('textbox', { name: 'Source' })).toHaveAttribute('maxlength', '500');
    expect(upload).not.toHaveBeenCalled();
  });
});
