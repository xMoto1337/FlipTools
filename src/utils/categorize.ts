/**
 * Auto-detect a listing category from its title using keyword matching.
 * Returns null if no confident match — caller should leave category as-is.
 */
export function autoDetectCategory(title: string): string | null {
  const l = title.toLowerCase();

  // Shoes — generic words + common reseller model names
  if (/\bsneakers?\b|\bshoes?\b|\bboots?\b|\bsandals?\b|\bslippers?\b|\bloafers?\b|\bclogs?\b|\bfootwear\b/.test(l)) return 'shoes';
  if (/\byeezy\b|\bdunks?\b|\bair\s+force\b|\bair\s+max\b|\bair\s+jordan\b|\bjordan\s*\d|\bstan\s+smith\b|\bchuck\s+taylor\b|\bultra\s*boost\b|\bnmd\b|\bvapormax\b|\bfoamposite\b|\bflyknit\b|\bsb\s+dunk\b|\baj\s*\d|\bnike\s+sb\b|\bnew\s+balance\s+\d/.test(l)) return 'shoes';

  // Clothing — garment words with word boundaries (avoids "laptop" matching "top")
  if (/\bt-?shirts?\b|\bhoodie\b|\bsweater\b|\bjacket\b|\bdress\b|\bjeans\b|\bpants\b|\bskirt\b|\bblouse\b|\bcardigan\b|\bblazer\b|\bwindbreaker\b|\bshorts\b|\bparka\b|\btrousers?\b|\bpullover\b|\bleggings?\b|\bsweatshirt\b|\btees?\b|\bpolo\b|\bcoat\b|\bfleece\b|\bjersey\b|\btops?\b/.test(l)) return 'clothing';

  // Electronics
  if (/\biphone\b|\bipad\b|\bmacbook\b|\blaptop\b|\bheadphones?\b|\bairpods?\b|\bplaystation\b|\bps[45]\b|\bxbox\b|\bnintendo\b|\bgpu\b|\bcpu\b|\bdrone\b|\bcamera\b/.test(l)) return 'electronics';

  // Toys
  if (/\blego\b|\bpok[eé]mon\b|\bfunko\b|\baction figure\b|\bhot wheels\b/.test(l)) return 'toys';

  // Collectibles
  if (/\bvintage\b|\bantique\b|\bcollectible\b|\btrading card\b|\bsports card\b|\bpsa\b|\bbgs\b/.test(l)) return 'collectibles';

  // Jewelry
  if (/\bjewelry\b|\bnecklace\b|\bbracelet\b|\bearrings?\b|\bpendant\b|\bwatch\b/.test(l)) return 'jewelry';

  // Media
  if (/\bvinyl\b|\bdvd\b|\bblu-ray\b/.test(l)) return 'media';

  // Sports
  if (/\bskateboard\b|\bsnowboard\b|\bsurfboard\b/.test(l)) return 'sports';

  // Home
  if (/\bfurniture\b|\bbedding\b|\bcookware\b/.test(l)) return 'home';

  return null;
}
