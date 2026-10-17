import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GlobalTransitions, TransitionButton, TransitionDialog } from './TransitionControls';
import { newFormat } from './model';
import { defaultTransitions } from './transitions';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('chooses a global random rule and shows it on the boundary button', () => {
  const format = newFormat(), onChange = vi.fn();
  const { rerender } = render(<GlobalTransitions format={format} language="it" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Modalità transizioni'), { target: { value: 'random' } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'random', duration: 1, intensity: .5 }));
  format.transitionDefaults = onChange.mock.calls[0]![0];
  rerender(<TransitionButton format={format} from="a" to="b" language="it" onClick={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Modifica transizione' })).toHaveTextContent('1.0 s');
});
it('edits and removes a single transition in the application dialog', () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  const onSave = vi.fn();
  render(<TransitionDialog value={null} language="it" onSave={onSave} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Tipo di transizione'), { target: { value: 'zoom-in' } });
  fireEvent.change(screen.getByLabelText(/Durata/), { target: { value: '1.5' } });
  fireEvent.change(screen.getByLabelText(/Intensità/), { target: { value: '.8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Applica transizione' }));
  expect(onSave).toHaveBeenCalledWith({ kind: 'zoom-in', duration: 1.5, intensity: .8 });
  fireEvent.click(screen.getByRole('button', { name: 'Nessuna transizione' }));
  expect(onSave).toHaveBeenLastCalledWith(null);
  expect(defaultTransitions.duration).toBe(1);
});
