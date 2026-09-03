import { beforeEach, describe, expect, it } from 'vitest';
import { localizeTree, statusLabel, t } from '../i18n/ro.js';

describe('Romanian admin localization', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('translates navigation, shared labels and statuses', () => {
    expect(t('Inventory')).toBe('Stoc');
    expect(t('Purchase Orders')).toBe('Comenzi de aprovizionare');
    expect(t('Save')).toBe('Salvează');
    expect(statusLabel('SHIPPED')).toBe('EXPEDIATĂ');
  });

  it('localizes legacy text nodes and accessible attributes', () => {
    const section = document.createElement('section');
    section.innerHTML = '<button title="Save">Save</button><input placeholder="Select warehouse">';
    document.body.appendChild(section);

    localizeTree(section);

    expect(section.querySelector('button').textContent).toBe('Salvează');
    expect(section.querySelector('button').title).toBe('Salvează');
    expect(section.querySelector('input').placeholder).toBe('Selectează depozitul');
  });

  it('leaves identifiers and business data untouched', () => {
    expect(t('SKU-001')).toBe('SKU-001');
    expect(t('MANN-FILTER')).toBe('MANN-FILTER');
  });
});

