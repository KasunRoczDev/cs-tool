'use client';

import { Children, Fragment, cloneElement, isValidElement, useId } from 'react';

function isControl(child) {
  if (!isValidElement(child) || child.type === Fragment) return false;
  if (typeof child.type !== 'string') return true;
  return ['input', 'select', 'textarea'].includes(child.type)
    && !['hidden', 'button', 'submit', 'reset', 'image'].includes(child.props.type);
}

function controlsIn(children) {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    return isControl(child) ? [child] : controlsIn(child.props.children);
  });
}

/**
 * Native controls may be nested in fragments/HTML wrappers. Custom controls must
 * forward id, required and aria-* to their input; do not use custom layout wrappers.
 * Multiple controls receive a fieldset/legend; retain individual option labels.
 * required applies to each control (use separate fields for optional group members).
 */
export default function FormField({ id, label, hint, error, children, required = false }) {
  const generatedId = useId();
  const fieldId = id || `field-${generatedId}`;
  const controls = controlsIn(children);
  const grouped = controls.length > 1;
  const hasHint = hint != null && hint !== false && hint !== '';
  const hasError = error != null && error !== false && error !== '';
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const firstId = controls[0]?.props.id || fieldId;
  let controlIndex = 0;

  function associate(nodes) {
    return Children.map(nodes, (child) => {
      if (!isValidElement(child)) return child;
      if (!isControl(child)) {
        return child.props.children == null ? child : cloneElement(child, {}, associate(child.props.children));
      }
      const index = controlIndex++;
      const describedBy = [child.props['aria-describedby'], hasHint && hintId, hasError && errorId]
        .filter(Boolean).join(' ');
      const props = {
        id: child.props.id || (grouped ? `${fieldId}-${index + 1}` : fieldId),
        'aria-describedby': describedBy || undefined,
        'aria-invalid': hasError ? true : child.props['aria-invalid'],
        required: required || child.props.required,
      };
      // Preserve option labels in groups; a single custom control also needs the field label.
      if (!grouped && !child.props['aria-label']) {
        props['aria-labelledby'] = [labelId, child.props['aria-labelledby']].filter(Boolean).join(' ');
      }
      return cloneElement(child, props);
    });
  }

  const Container = grouped ? 'fieldset' : 'div';
  const Label = grouped ? 'legend' : 'label';

  return (
    <Container className={`ui-form-field${hasError ? ' ui-form-field--invalid' : ''}`}>
      <Label className="ui-field-label" id={labelId} htmlFor={grouped ? undefined : firstId}>
        {label}{required && <span className="ui-field-required"> (required)</span>}
      </Label>
      {hasHint && <div className="ui-field-hint" id={hintId}>{hint}</div>}
      <div className="ui-field-controls">{associate(children)}</div>
      {hasError && <div className="ui-field-error" id={errorId}>{error}</div>}
    </Container>
  );
}
