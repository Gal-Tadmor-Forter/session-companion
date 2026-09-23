import { useEffect, useState } from "react";

// The actual `claude` CLI binary's own spinner wordlist ("Pondering…", "Marinating…",
// etc., shown while it's thinking) — the SDK doesn't expose this as data, so it was
// pulled once via `strings` on the compiled binary rather than sourced from a network
// call. Kept alphabetical, matching the order found there.
export const THINKING_VERBS = [
  "Accomplishing", "Actioning", "Actualizing", "Architecting", "Baking", "Beaming",
  "Beboppin'", "Befuddling", "Billowing", "Blanching", "Bloviating", "Boogieing",
  "Boondoggling", "Booping", "Bootstrapping", "Brewing", "Bunning", "Burrowing",
  "Calculating", "Canoodling", "Caramelizing", "Cascading", "Catapulting", "Cerebrating",
  "Channeling", "Channelling", "Choreographing", "Churning", "Clauding", "Coalescing",
  "Cogitating", "Combobulating", "Composing", "Computing", "Concocting", "Considering",
  "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Crystallizing",
  "Cultivating", "Deciphering", "Deliberating", "Determining", "Dilly-dallying",
  "Discombobulating", "Doing", "Doodling", "Drizzling", "Ebbing", "Effecting",
  "Elucidating", "Embellishing", "Enchanting", "Envisioning", "Fermenting",
  "Fiddle-faddling", "Finagling", "Flambéing", "Flibbertigibbeting", "Flowing",
  "Flummoxing", "Fluttering", "Forging", "Forming", "Frolicking", "Frosting",
  "Gallivanting", "Galloping", "Garnishing", "Generating", "Gesticulating",
  "Germinating", "Gitifying", "Grooving", "Gusting", "Harmonizing", "Hashing",
  "Hatching", "Herding", "Honking", "Hullaballooing", "Hyperspacing", "Ideating",
  "Imagining", "Improvising", "Incubating", "Inferring", "Infusing", "Ionizing",
  "Jitterbugging", "Julienning", "Kerfuffling", "Kneading", "Leavening", "Levitating",
  "Lollygagging", "Manifesting", "Marinating", "Meandering", "Metamorphosing",
  "Misting", "Moonwalking", "Moseying", "Mulling", "Mustering", "Musing", "Nebulizing",
  "Nesting", "Newspapering", "Noodling", "Nucleating", "Orbiting", "Orchestrating",
  "Osmosing", "Perambulating", "Percolating", "Perusing", "Philosophising",
  "Photosynthesizing", "Pollinating", "Pondering", "Pontificating", "Pouncing",
  "Precipitating", "Prestidigitating", "Proofing", "Propagating", "Puttering",
  "Puzzling", "Quantumizing", "Razzle-dazzling", "Razzmatazzing", "Recombobulating",
  "Reticulating", "Roosting", "Ruminating", "Sautéing", "Scampering", "Schlepping",
  "Scurrying", "Seasoning", "Shenaniganing", "Shimmying", "Simmering", "Skedaddling",
  "Sketching", "Slithering", "Smooshing", "Sock-hopping", "Spelunking", "Spinning",
  "Sprouting", "Stewing", "Sublimating", "Swirling", "Swooping", "Symbioting",
  "Synthesizing", "Tempering", "Thundering", "Tinkering", "Tomfoolering",
  "Topsy-turvying", "Transfiguring", "Transmogrifying", "Transmuting", "Twisting",
  "Undulating", "Unfurling", "Unravelling", "Vibing", "Waddling", "Wandering",
  "Warping", "Whatchamacalliting", "Whirlpooling", "Whirring", "Whisking", "Wibbling",
  "Wrangling", "Zesting",
];

function randomThinkingVerb(): string {
  return THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)];
}

/** Cycles to a new random verb (e.g. "Pondering…") every `intervalMs` while `active` —
 * frozen on its last pick while inactive, rather than ticking away unseen. */
export function useThinkingVerb(active: boolean, intervalMs = 2500): string {
  const [verb, setVerb] = useState(randomThinkingVerb);
  useEffect(() => {
    if (!active) return;
    setVerb(randomThinkingVerb());
    const id = setInterval(() => setVerb(randomThinkingVerb()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return verb;
}
