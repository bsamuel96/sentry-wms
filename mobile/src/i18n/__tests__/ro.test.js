import { describe, expect, it } from 'vitest';
import { translateRo } from '../ro.js';

describe('localizare mobilă în limba română', () => {
  it('traduce etichete, acțiuni și mesaje de eroare uzuale', () => {
    expect(translateRo('WAREHOUSE MANAGEMENT')).toBe('GESTIUNEA DEPOZITULUI');
    expect(translateRo('SCAN ORDER')).toBe('SCANEAZĂ COMANDA');
    expect(translateRo('Failed to complete pack')).toBe('Ambalarea nu a putut fi finalizată');
    expect(translateRo('Username')).toBe('Utilizator');
  });

  it('traduce mesajele dinamice fără să modifice identificatorii', () => {
    expect(translateRo('Order SO-42 packed')).toBe('Comanda SO-42 a fost ambalată');
    expect(translateRo('Wrong item — expected W79')).toBe('Produs greșit — era așteptat W79');
    expect(translateRo('Page 2 of 4')).toBe('Pagina 2 din 4');
    expect(translateRo('Page')).toBe('Pagina');
    expect(translateRo('of')).toBe('din');
  });

  it('lasă neatinse codurile și textele deja în română', () => {
    expect(translateRo('W79')).toBe('W79');
    expect(translateRo('VÂNZARE FINALIZATĂ')).toBe('VÂNZARE FINALIZATĂ');
  });
});
