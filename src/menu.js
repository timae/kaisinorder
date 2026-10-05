// Menu data taken from Kaisin's order form (OrderForm_RegLarge.pdf).
// Option labels for custom bowls MUST match the dropdown options in the PDF;
// pdf.js maps them onto the exact option strings at fill time.

const LARGE_SURCHARGE = 3.0; // Signature bowls: large = regular + 3.00 CHF. Assumed the same for custom bowls.

const SIGNATURE = [
  { id: 'kind-of-spicy', name: 'Kind of Spicy', protein: 'Salmon', base: 'Sushi rice',
    toppings: ['Seaweed salad', 'Mango', 'Edamame', 'Cucumber'], sauce: 'Wasabi lime sauce',
    finish: ['Ginger', 'Wasabi nuts'], price: { regular: 23.9, large: 26.9 },
    fields: { regular: 'KOS REG 14', large: 'KOS LARGE 15' } },
  { id: 'classic-ponzu', name: 'Classic Ponzu', protein: 'Tuna', base: 'Black rice',
    toppings: ['Tomatoes', 'Mango', 'Edamame', 'Ginger guacamole'], sauce: 'Ponzu lime sauce',
    finish: ['Pomegranate', 'Ginger'], price: { regular: 23.9, large: 26.9 },
    fields: { regular: 'KOS REG 13', large: 'KOS LARGE 13' } },
  { id: 'spicy-chicken', name: 'Spicy Chicken', protein: 'Chicken', base: 'Sushi rice',
    toppings: ['Tomatoes', 'Cucumber', 'Coleslaw', 'Ginger guacamole'], sauce: 'Creamy sriracha sauce',
    finish: ['Umami crunch', 'Feta'], price: { regular: 23.9, large: 26.9 },
    fields: { regular: 'KOS REG 12', large: 'KOS LARGE 12' } },
  { id: 'miso-chicken', name: 'Miso Chicken', protein: 'Chicken', base: 'Sushi rice',
    toppings: ['Kale', 'Cucumber', 'Radish', 'Coleslaw'], sauce: 'Miso vinaigrette',
    finish: ['Nori blend', 'Almonds'], price: { regular: 23.9, large: 26.9 },
    fields: { regular: 'KOS REG 10', large: 'KOS LARGE 10' } },
  { id: 'beef-og', name: 'Beef O.G.', protein: 'Lemongrass beef', base: 'Sushi rice',
    toppings: ['Sweet potato', 'Broccoli', 'Kale', 'Radish'], sauce: 'Creamy sriracha sauce',
    finish: ['Nori blend', 'Yuzu kohlrabi'], price: { regular: 24.9, large: 27.9 },
    fields: { regular: 'KOS REG 11', large: 'KOS LARGE 11' } },
  { id: 'miso-salmon', name: 'Miso Salmon', protein: 'Miso-glazed salmon', base: 'Sushi rice',
    toppings: ['Cucumber', 'Coleslaw', 'Kale', 'Sweet potato'], sauce: 'Ponzu lime sauce',
    finish: ['Yuzu drizzle', 'Nori blend'], price: { regular: 24.9, large: 27.9 },
    fields: { regular: 'KOS REG 9', large: 'KOS LARGE 9' } },
  { id: 'umami-chicken-salad', name: 'Umami Chicken Salad', protein: 'Chicken', base: 'Lettuce',
    toppings: ['Edamame', 'Cucumber', 'Radish', 'Ginger guacamole'], sauce: 'Citrus vinaigrette',
    finish: ['Umami crunch', 'Yuzu kohlrabi'], price: { regular: 23.9, large: 26.9 },
    fields: { regular: 'KOS REG 8', large: 'KOS LARGE 8' } },
  { id: 'the-tofu', name: 'The Tofu', protein: 'Golden tofu', base: 'Sushi rice',
    toppings: ['Kale', 'Coleslaw', 'Cucumber', 'Edamame'], sauce: 'Miso vinaigrette',
    finish: ['Umami crunch', 'Yuzu drizzle'], price: { regular: 19.9, large: 22.9 },
    fields: { regular: 'KOS REG 7', large: 'KOS LARGE 7' } },
];

const CUSTOM = {
  proteins: [
    { name: 'MISO-GLAZED SALMON', price: 24.9 },
    { name: 'LEMONGRASS BEEF', price: 24.9 },
    { name: 'SALMON', price: 23.9 },
    { name: 'TUNA', price: 23.9 },
    { name: 'CHICKEN', price: 23.9 },
    { name: 'PLANTED CHICKEN', price: 22.9 },
    { name: 'GOLDEN TOFU', price: 19.9 },
  ],
  bases: ['SUSHI RICE', 'BLACK RICE', 'QUINOA', 'CAULIFLOWER RICE', 'KALE', 'LETTUCE'],
  toppings: ['EDAMAME', 'SEAWEED SALAD', 'MANGO', 'COLESLAW', 'CUCUMBER', 'GINGER GUACAMOLE',
    'TOMATOES', 'KALE', 'BROCCOLI', 'RADISH', 'SWEET POTATO'],
  sauces: ['WASABI LIME', 'CREAMY SRIRACHA', 'TERIYAKI', 'PONZU LIME', 'PEANUT',
    'MISO VINAIGRETTE', 'TASTY TRUFFLE', 'CITRUS VINAIGRETTE'],
  finishes: ['WASABI NUTS', 'POMEGRANATE', 'CORIANDER', 'GINGER', 'SESAME', 'ALMONDS', 'FETA',
    'CREAM CHEESE', 'YUZU KOHLRABI', 'NORI BLEND', 'YUZU DRIZZLE', 'UMAMI CRUNCH'],
  maxToppings: 4,
  maxFinishes: 2,
};

const SIZES = ['regular', 'large'];

function signatureById(id) {
  return SIGNATURE.find((s) => s.id === id);
}

function customPrice(custom, size) {
  const p = CUSTOM.proteins.find((x) => x.name === custom.protein);
  if (!p) return 0;
  return Math.round((p.price + (size === 'large' ? LARGE_SURCHARGE : 0)) * 100) / 100;
}

// Validates and normalises an order payload. Throws Error with a user-facing message.
function validateOrder(input) {
  input = input || {};
  const person = String(input.person || '').trim().slice(0, 60);
  if (!person) throw new Error('Please enter your name.');
  const size = input.size === 'large' ? 'large' : input.size === 'regular' ? 'regular' : null;
  if (!size) throw new Error('Please choose a size.');
  const note = String(input.note || '').trim().slice(0, 200);

  if (input.kind === 'signature') {
    const sig = signatureById(input.signature);
    if (!sig) throw new Error('Please choose a signature bowl.');
    return { person, size, note, kind: 'signature', signature: sig.id, custom: null };
  }

  if (input.kind === 'custom') {
    const c = input.custom || {};
    const pick = (val, list, label) => {
      if (!list.includes(val)) throw new Error(`Please choose a ${label}.`);
      return val;
    };
    const protein = pick(c.protein, CUSTOM.proteins.map((p) => p.name), 'protein');
    const base = pick(c.base, CUSTOM.bases, 'base');
    const sauce = pick(c.sauce, CUSTOM.sauces, 'sauce');
    const toppings = (Array.isArray(c.toppings) ? c.toppings : []).filter(Boolean);
    const finishes = (Array.isArray(c.finishes) ? c.finishes : []).filter(Boolean);
    if (toppings.length > CUSTOM.maxToppings) throw new Error(`Max ${CUSTOM.maxToppings} toppings.`);
    if (finishes.length > CUSTOM.maxFinishes) throw new Error(`Max ${CUSTOM.maxFinishes} finishes.`);
    toppings.forEach((t) => pick(t, CUSTOM.toppings, 'valid topping'));
    finishes.forEach((f) => pick(f, CUSTOM.finishes, 'valid finish'));
    return { person, size, note, kind: 'custom', signature: null,
      custom: { protein, base, toppings, sauce, finishes } };
  }

  throw new Error('Please choose a signature bowl or create your own.');
}

module.exports = { SIGNATURE, CUSTOM, SIZES, LARGE_SURCHARGE, signatureById, customPrice, validateOrder };
