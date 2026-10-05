// Fills Kaisin's original AcroForm (assets/OrderForm_RegLarge.pdf) so the output is exactly the
// form Kaisin expects. Field names were mapped from the PDF; see README for the table.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { SIGNATURE } = require('./menu');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'assets', 'OrderForm_RegLarge.pdf'));
const SLOTS_PER_PAGE = 8;

const CYO_LARGE = ['CYO 1 LARGE', 'CYO 1 LARGE 1', 'CYO 1 LARGE 2', 'CYO 1 LARGE 3',
  'CYO 1 LARGE 4', 'CYO 1 LARGE 8', 'CYO 1 LARGE 9', 'CYO 1 LARGE 10'];
const sfx = (base, i) => (i === 0 ? base : `${base} ${i}`);

function slotFields(i) {
  return {
    name: `Bowl Name 0${i + 1}`,
    regular: sfx('CYO 1 REG', i),
    large: CYO_LARGE[i],
    protein: sfx('CYO 1 PROTEIN', i),
    base: sfx('CYO 1 BASE', i),
    toppings: [1, 2, 3, 4].map((n) => `CYO 1 TOPPING ${4 * i + n}`),
    sauce: sfx('CYO 1 SAUCE', i),
    finishes: [1, 2].map((n) => `CYO 1 FINISH ${2 * i + n}`),
    qty: sfx('CYO 1 #', i),
  };
}

const EXTRAS = { cutlery: 'CYO 1 LARGE 5', chopsticks: 'CYO 1 LARGE 6', napkins: 'CYO 1 LARGE 7' };

const CONTACT = {
  name: 'CONTACT INFO: Name',
  company: 'CONTACT INFO: Company',
  phone: 'CONTACT INFO: Phone number',
  email: 'CONTACT INFO: Email',
  deliveryAddress: 'CONTACT INFO: Delivery Address',
  invoiceAddress: 'CONTACT INFO: Invoice Address',
  notes: 'CONTACT INFO: Notes',
};

function formatDate(d) {
  const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const [y, m, day] = iso.split('-');
  return `${day}.${m}.${y}`;
}

class Filler {
  constructor(doc, font) {
    this.doc = doc;
    this.font = font;
    this.form = doc.getForm();
  }

  // Keep only characters the standard Helvetica font can encode (WinAnsi).
  clean(text) {
    let out = '';
    for (const ch of String(text ?? '')) {
      if (this.encodable(ch)) { out += ch; continue; }
      const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += stripped && [...stripped].every((c) => this.encodable(c)) ? stripped : '?';
    }
    return out;
  }

  encodable(ch) {
    try { this.font.encodeText(ch); return true; } catch { return false; }
  }

  text(name, value, defaultSize = 10) {
    const v = this.clean(value);
    if (!v) return;
    const field = this.form.getTextField(name);
    const widget = field.acroField.getWidgets()[0];
    const width = widget.getRectangle().width - 4;
    let size = defaultSize;
    while (size > 6 && this.font.widthOfTextAtSize(v, size) > width) size -= 0.5;
    let fitted = v;
    while (fitted.length > 1 && this.font.widthOfTextAtSize(fitted, size) > width) {
      fitted = fitted.slice(0, -2) + '…';
    }
    field.setFontSize(size);
    field.setText(fitted);
  }

  select(name, value) {
    if (!value) return;
    const dd = this.form.getDropdown(name);
    const want = String(value).trim().toUpperCase();
    const opt = dd.getOptions().find((o) => {
      const t = o.trim().toUpperCase();
      return t === want || t.startsWith(`${want} CHF`);
    });
    if (!opt) throw new Error(`Option "${value}" not found in PDF field "${name}"`);
    dd.select(opt);
    // The dropdown widgets are only 10pt tall; the template's 10pt font gets clipped.
    dd.setFontSize(7.5);
  }

  check(name, on) {
    if (on) this.form.getCheckBox(name).check();
  }

  fillCustomSlots(groups) {
    groups.slice(0, SLOTS_PER_PAGE).forEach((g, i) => {
      const f = slotFields(i);
      this.text(f.name, g.people.join(', '));
      this.check(g.size === 'large' ? f.large : f.regular, true);
      this.select(f.protein, g.custom.protein);
      this.select(f.base, g.custom.base);
      g.custom.toppings.forEach((t, n) => this.select(f.toppings[n], t));
      this.select(f.sauce, g.custom.sauce);
      g.custom.finishes.forEach((x, n) => this.select(f.finishes[n], x));
      this.text(f.qty, String(g.qty));
    });
  }

  finish() {
    this.form.updateFieldAppearances(this.font);
  }
}

async function load() {
  const doc = await PDFDocument.load(TEMPLATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  return new Filler(doc, font);
}

/**
 * @param round  row from `rounds` (contact, extras, notes, notes_custom, delivery_date, delivery_time)
 * @param agg    result of aggregate()
 * @returns Uint8Array PDF bytes
 */
async function buildOrderPdf(round, agg) {
  const main = await load();
  const contact = round.contact || {};
  const extras = round.extras || {};

  // Page 1 — signature bowls
  for (const s of SIGNATURE) {
    const counts = agg.signature[s.id];
    if (counts.regular) main.text(s.fields.regular, String(counts.regular));
    if (counts.large) main.text(s.fields.large, String(counts.large));
  }
  if (agg.signatureTotal) main.text('TOTAL OF SIGNATURE BOWLS', String(agg.signatureTotal));
  for (const [key, field] of Object.entries(EXTRAS)) main.check(field, !!extras[key]);
  main.text('NOTES', round.notes, 12);

  // Page 2 — create your own (first 8 distinct bowls)
  const chunks = [];
  for (let i = 0; i < agg.customGroups.length; i += SLOTS_PER_PAGE) {
    chunks.push(agg.customGroups.slice(i, i + SLOTS_PER_PAGE));
  }
  if (chunks.length) main.fillCustomSlots(chunks[0]);
  const pageNote = (k) => (chunks.length > 1 ? `Create-your-own page ${k + 1} of ${chunks.length}. ` : '');
  main.text('NOTES 2', pageNote(0) + (round.notes_custom || ''), 12);

  // Page 3 — contact information
  for (const [key, field] of Object.entries(CONTACT)) main.text(field, contact[key], 12);
  main.text('CONTACT INFO: Date', formatDate(round.delivery_date), 12);
  main.text('CONTACT INFO: Time', round.delivery_time, 12);
  main.finish();

  // More than 8 distinct custom bowls: append extra (flattened) copies of page 2.
  for (let k = 1; k < chunks.length; k++) {
    const extra = await load();
    extra.fillCustomSlots(chunks[k]);
    extra.text('NOTES 2', pageNote(k), 12);
    extra.finish();
    extra.form.flatten();
    const [page] = await main.doc.copyPages(extra.doc, [1]);
    main.doc.insertPage(1 + k, page);
  }

  main.doc.setTitle(`Kaisin order ${formatDate(round.delivery_date)}`);
  return main.doc.save();
}

module.exports = { buildOrderPdf, formatDate, slotFields };
