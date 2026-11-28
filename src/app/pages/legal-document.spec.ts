import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { LegalDocument } from './legal-document';
import { LegalDoc, PRIVACY_POLICY, TERMS_OF_USE } from './legal-text';

function render(doc: LegalDoc): HTMLElement {
  const fixture = TestBed.createComponent(LegalDocument);
  fixture.componentRef.setInput('doc', doc);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('LegalDocument', () => {
  it('shows the whole Privacy Policy with its sections, provider table and contact', () => {
    const el = render(PRIVACY_POLICY);
    expect(el.querySelector('h1')?.textContent).toBe('Privacy Policy');
    expect(el.textContent).toContain('Last updated: 28 November 2026');
    expect(el.querySelectorAll('h2').length).toBe(PRIVACY_POLICY.sections.length);
    expect(el.querySelector('table')?.textContent).toContain('PayU Payments Private Limited');
    expect(el.textContent).toContain('support@forumlabs.in');
    expect(el.textContent).toContain('Forum Hospital and Healthcare LLP');
    expect(el.textContent).not.toContain('[');
    expect(el.querySelector('strong')).not.toBeNull();
  });

  it('shows the Terms of Use with online payment and refunds, and no placeholders', () => {
    const el = render(TERMS_OF_USE);
    expect(el.querySelector('h1')?.textContent).toBe('Terms of Use');
    expect(el.textContent).toContain('through our payment partner PayU');
    expect(el.textContent).toContain('Refunds of online payments');
    expect(el.textContent).toContain('courts at Bengaluru');
    expect(el.textContent).not.toContain('[');
  });
});
