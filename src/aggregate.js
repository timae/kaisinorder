const { SIGNATURE, signatureById, customPrice } = require('./menu');

function customKey(size, c) {
  return JSON.stringify([size, c.protein, c.base, [...c.toppings].sort(), c.sauce, [...c.finishes].sort()]);
}

// Turns individual orders into what goes onto Kaisin's form.
function aggregate(orders) {
  const signature = {};
  for (const s of SIGNATURE) signature[s.id] = { regular: 0, large: 0, people: [] };

  const groups = new Map();
  let estTotal = 0;

  for (const o of orders) {
    if (o.kind === 'signature') {
      const sig = signatureById(o.signature);
      if (!sig) continue;
      signature[sig.id][o.size] += 1;
      signature[sig.id].people.push(o.person);
      estTotal += sig.price[o.size];
    } else if (o.kind === 'custom' && o.custom) {
      const key = customKey(o.size, o.custom);
      if (!groups.has(key)) groups.set(key, { size: o.size, custom: o.custom, people: [] });
      groups.get(key).people.push(o.person);
      estTotal += customPrice(o.custom, o.size);
    }
  }

  const customGroups = [...groups.values()].map((g) => ({ ...g, qty: g.people.length }));
  const signatureTotal = Object.values(signature).reduce((n, s) => n + s.regular + s.large, 0);
  const customTotal = customGroups.reduce((n, g) => n + g.qty, 0);

  return {
    signature,
    signatureTotal,
    customGroups,
    customTotal,
    totalBowls: signatureTotal + customTotal,
    customPages: Math.max(1, Math.ceil(customGroups.length / 8)),
    estTotal: Math.round(estTotal * 100) / 100,
  };
}

module.exports = { aggregate };
