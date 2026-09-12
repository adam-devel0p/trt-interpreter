import type { CardSeed } from '@/domain/decks/types';
import { court, pip } from './_builders';

/**
 * Thoth Wands (fire) and Cups (water). Small cards carry Crowley's titles and the Golden Dawn
 * decan and sephira; courts are Knight / Queen / Prince / Princess (highest to lowest, stored
 * lowest first: Princess 0 · Prince 1 · Queen 2 · Knight 3). No reversed meanings.
 */
type PipIn = Parameters<typeof pip>[0];
type CourtIn = Parameters<typeof court>[0];
const TP = (i: Omit<PipIn, 'reversed' | 'rev'>) => pip({ ...i, reversed: null, rev: [] });
const TC = (i: Omit<CourtIn, 'reversed' | 'rev'>) => court({ ...i, reversed: null, rev: [] });

const W = { suit: 'wands', suitLabel: 'Wands', base: 22 } as const;
const C = { suit: 'cups', suitLabel: 'Cups', base: 36 } as const;

export const THOTH_WANDS: CardSeed[] = [
  TP({
    ...W,
    number: 1,
    title: null,
    astrology: 'Root of the Powers of Fire',
    correspondences: { sephira: 'Kether', esoteric_title: 'Root of the Powers of Fire' },
    up: [
      'primal fire',
      'the flaming wand',
      'will as force',
      'Kether in Atziluth',
      'energy before form',
    ],
    meaning:
      'The Ace of Wands is fire in Kether: a torch whose flames are shaped as the ten sephiroth, energy in its first and purest movement, before any object has been chosen for it. Crowley describes it as the essence of the element rather than its application — the solar-phallic will that the other nine cards will spend, direct or waste. The card suggests a surge of creative force; ask what it is for before it decides for you.',
    symbolism:
      'A great wooden club bursting into flame, the flames arranged in the pattern of the Tree of Life, lightning branching from the wood against a field of yellow.',
  }),
  TP({
    ...W,
    number: 2,
    title: 'Dominion',
    astrology: 'Mars in Aries',
    correspondences: {
      sephira: 'Chokmah',
      decan: 'Mars in Aries · 1st decan',
      planet: 'Mars',
      zodiac: 'Aries',
      esoteric_title: 'Lord of Dominion',
    },
    up: [
      'dominion',
      'will established',
      'Mars exalted in Aries',
      'the crossed dorjes',
      'fire at its most direct',
    ],
    meaning:
      'Dominion is Chokmah in the suit of fire with Mars in Aries: the will having found its first expression and ruling without opposition. Crowley draws two Tibetan dorjes crossed, thunderbolts of unbroken force, with flames pouring from them. The card suggests energy that is perfectly placed and knows it; one way to read it is as authority that needs no argument, and the question of what such authority will be used to do.',
    symbolism:
      'Two crossed dorjes tipped with flame, six flames issuing from their meeting, arrowheads of fire radiating, in the reds of Mars and Aries.',
  }),
  TP({
    ...W,
    number: 3,
    title: 'Virtue',
    astrology: 'Sun in Aries',
    correspondences: {
      sephira: 'Binah',
      decan: 'Sun in Aries · 2nd decan',
      planet: 'Sun',
      zodiac: 'Aries',
      esoteric_title: 'Lord of Virtue',
    },
    up: [
      'virtue',
      'integrity of will',
      'the lotus wands',
      'the Sun in Aries',
      'established character',
    ],
    meaning:
      'Virtue is Binah of fire — the will given a form it can keep. Crowley uses the word in its old sense of strength of character rather than propriety: three lotus wands, the flames now steady rather than explosive, the Sun in the sign of its exaltation. The card suggests energy that has become reliable, a first sense of what one is for; consider what principle is now guiding the force that Dominion merely possessed.',
    symbolism:
      'Three wands topped with lotus blossoms rising through an ordered blaze of ten flames, the fire organised and upright, the background a harvest orange.',
  }),
  TP({
    ...W,
    number: 4,
    title: 'Completion',
    astrology: 'Venus in Aries',
    correspondences: {
      sephira: 'Chesed',
      decan: 'Venus in Aries · 3rd decan',
      planet: 'Venus',
      zodiac: 'Aries',
      esoteric_title: 'Lord of Completion',
    },
    up: [
      'completion',
      'the circle closed',
      'Chesed of fire',
      'order achieved',
      'the ram and the dove',
    ],
    meaning:
      'Completion is the fire of Chesed, Jupiter’s sphere: the work of the first three cards finished and set in a wheel. Eight flames enclose the circle, the ram of Aries and the dove of Venus tip the spokes, and Crowley notes that the perfection of the card is also its limit — nothing more can be done with this particular energy. It suggests a task genuinely done; one way to read it is to recognise the closure so as not to keep working on what is finished.',
    symbolism:
      'Four wands crossed to form a wheel of eight spokes, each tipped alternately with a ram’s head and a dove, a ring of flame around the hub, the whole in the gold and green of Venus in Aries.',
  }),
  TP({
    ...W,
    number: 5,
    title: 'Strife',
    astrology: 'Saturn in Leo',
    correspondences: {
      sephira: 'Geburah',
      decan: 'Saturn in Leo · 1st decan',
      planet: 'Saturn',
      zodiac: 'Leo',
      esoteric_title: 'Lord of Strife',
    },
    up: [
      'strife',
      'Saturn dragging on Leo',
      'the wand of the Chief Adept',
      'friction',
      'force against inertia',
    ],
    meaning:
      'Strife is Geburah of fire with the heavy planet Saturn set in the exuberant sign Leo: energy fighting its own weight. Crowley shows the wand of the Chief Adept with its winged phoenix head, crossed by the lotus and phoenix wands of the lesser grades, all struggling in flame. The card suggests conflict that arises from structure resisting vigour rather than from an enemy; consider what is slowing the fire and whether the friction is producing anything.',
    symbolism:
      'A large phoenix-headed wand upright in the centre with two lotus wands and two phoenix wands crossed behind it, ten flames breaking outward, the background a stormy red.',
  }),
  TP({
    ...W,
    number: 6,
    title: 'Victory',
    astrology: 'Jupiter in Leo',
    correspondences: {
      sephira: 'Tiphareth',
      decan: 'Jupiter in Leo · 2nd decan',
      planet: 'Jupiter',
      zodiac: 'Leo',
      esoteric_title: 'Lord of Victory',
    },
    up: [
      'victory',
      'Tiphareth of fire',
      'the three wands harmonised',
      'balanced energy',
      'Jupiter in Leo',
    ],
    meaning:
      'Victory is Tiphareth in the suit of fire: the wands of the three Adept grades — lotus, phoenix and winged — now arranged in harmony, each with its flame burning evenly, Jupiter’s generosity in the Sun’s own sign. Crowley stresses that the triumph is one of balance, not conquest. The card suggests energy that has stopped fighting itself and is therefore effective; one way to read it is to notice what became possible when the parts cooperated.',
    symbolism:
      'Three pairs of wands — phoenix, lotus and winged solar — crossed in a lattice, nine even flames lit between them, set against a field of clear orange and violet.',
  }),
  TP({
    ...W,
    number: 7,
    title: 'Valour',
    astrology: 'Mars in Leo',
    correspondences: {
      sephira: 'Netzach',
      decan: 'Mars in Leo · 3rd decan',
      planet: 'Mars',
      zodiac: 'Leo',
      esoteric_title: 'Lord of Valour',
    },
    up: [
      'valour',
      'Netzach of fire',
      'the rough club',
      'courage in a losing position',
      'Mars in Leo',
    ],
    meaning:
      'Valour is Netzach of fire — the seventh card, where Crowley says the energy of the suit has begun to degenerate and can only be sustained by courage. The six ordered wands of Victory are now dimmed behind a single crude club, the untrained weapon of someone fighting with whatever is to hand. The card suggests bravery required precisely because the position is weakening; consider whether the fight is worth what it costs and what you are actually defending.',
    symbolism:
      'A rough wooden club laid across six neater wands whose flames have grown ragged, the fire uneven and smoky, the colours dulled to a bruised red and grey.',
  }),
  TP({
    ...W,
    number: 8,
    title: 'Swiftness',
    astrology: 'Mercury in Sagittarius',
    correspondences: {
      sephira: 'Hod',
      decan: 'Mercury in Sagittarius · 1st decan',
      planet: 'Mercury',
      zodiac: 'Sagittarius',
      esoteric_title: 'Lord of Swiftness',
    },
    up: ['swiftness', 'fire become light', 'electricity', 'the rainbow', 'Mercury in Sagittarius'],
    meaning:
      'Swiftness is Hod of fire: the energy of the suit has refined itself past flame into pure vibration — light, electricity, speech. Crowley draws eight wands as arrows of lightning meeting at a central octagon beneath a rainbow, the flames gone entirely. The card suggests communication and movement at high frequency; one way to read it is that a matter is now carried by messages and impulses rather than by force, and will move faster than deliberation.',
    symbolism:
      'Eight lightning-shaped wands radiating from a central geometric figure, a rainbow arched above, the whole in the pale electric blues and yellows of pure energy rather than fire.',
  }),
  TP({
    ...W,
    number: 9,
    title: 'Strength',
    astrology: 'Moon in Sagittarius',
    correspondences: {
      sephira: 'Yesod',
      decan: 'Moon in Sagittarius · 2nd decan',
      planet: 'Moon',
      zodiac: 'Sagittarius',
      esoteric_title: 'Lord of Great Strength',
    },
    up: [
      'strength',
      'Yesod of fire',
      'the arrow of the moon',
      'stability through change',
      'recovered force',
    ],
    meaning:
      'The Nine of Wands, Strength, is Yesod of fire: energy that has found its foundation. Crowley shows the wand as an arrow with the sun at its head and the moon at its point, crossed by eight arrows whose fletchings make a lattice — change so regular that it has become a form of stability. The card suggests force that endures by renewing itself rather than by resisting; consider what routine or rhythm is holding you steady, and whether it is still alive.',
    symbolism:
      'A long arrow tipped with the sun and fletched with the moon down the centre, eight lesser arrows crossed behind, ten crescents of the moon’s phases around them, in violet and orange.',
  }),
  TP({
    ...W,
    number: 10,
    title: 'Oppression',
    astrology: 'Saturn in Sagittarius',
    correspondences: {
      sephira: 'Malkuth',
      decan: 'Saturn in Sagittarius · 3rd decan',
      planet: 'Saturn',
      zodiac: 'Sagittarius',
      esoteric_title: 'Lord of Oppression',
    },
    up: [
      'oppression',
      'fire become a prison',
      'the dorjes as bars',
      'force turned to cruelty',
      'Malkuth of fire',
    ],
    meaning:
      'Oppression is fire in Malkuth: the element at its most material, where the will that began as a torch has hardened into a cage of bars. Crowley draws the two dorjes of Dominion again, now lengthened into a grate, with eight straight rods behind them and the flames replaced by a heavy, smoky heat. The card suggests energy that has been held too rigidly for too long and has become tyranny — over others or oneself; ask what was once a legitimate force and is now simply a weight.',
    symbolism:
      'Two long dorjes and eight plain rods forming a grille, flames pressed flat and dulled behind them, the whole in the dark reds and blacks of Saturn overpowering the archer’s sign.',
  }),
  TC({
    ...W,
    rank: 'Princess',
    rankIndex: 0,
    astrology: 'Earth of Fire',
    correspondences: {
      sub_element: 'earth',
      rulership: 'The quadrant Cancer–Leo–Virgo (Asia)',
      esoteric_title: 'Princess of the Shining Flame, the Rose of the Palace of Fire',
    },
    up: [
      'earth of fire',
      'the sacrificial fire',
      'daring',
      'the tiger and the altar',
      'fire made tangible',
    ],
    meaning:
      'The Princess of Wands is the earth of fire — the element made tangible as an act of self-offering. Crowley shows her naked, plumed with justice, leaping through flame with a tiger at her side and the sacrificial altar behind her: fuel, not the flame; the one who feeds the fire with herself. The card suggests enthusiasm that is fearless because it has not yet learned the cost; consider what you are ready to throw on the fire and what the fire is for.',
    symbolism:
      'A naked woman with a plume of the goddess of justice, a wand tipped with the sun in one hand, leaping over flames beside a tiger, the ram-headed altar and its fire behind her.',
  }),
  TC({
    ...W,
    rank: 'Prince',
    rankIndex: 1,
    astrology: 'Air of Fire',
    correspondences: {
      sub_element: 'air',
      rulership: '20° Cancer – 20° Leo',
      esoteric_title: 'Prince of the Chariot of Fire',
    },
    up: [
      'air of fire',
      'the phoenix wand',
      'the lion-drawn chariot',
      'swift generous force',
      'impulsive justice',
    ],
    meaning:
      'The Prince of Wands is air of fire — flame lifted into motion, drawn in his chariot by a lion, holding the phoenix wand of the Adeptus Major. Crowley describes him as generous, swift, proud and easily bored: a will that is genuine but wants its effects at once. The card suggests energy carried forward by someone who sees the end and forgets the middle; one way to read it is to ask whether the speed is serving the aim or merely the rider.',
    symbolism:
      'A crowned young man in a chariot of flame drawn by a lion, the phoenix-headed wand in hand, the rays of the sun behind him and flames streaming in his wake.',
  }),
  TC({
    ...W,
    rank: 'Queen',
    rankIndex: 2,
    astrology: 'Water of Fire',
    correspondences: {
      sub_element: 'water',
      rulership: '20° Pisces – 20° Aries',
      esoteric_title: 'Queen of the Thrones of Flame',
    },
    up: [
      'water of fire',
      'the leopard',
      'steady heat',
      'command by presence',
      'the pine-cone wand',
    ],
    meaning:
      'The Queen of Wands is water of fire — the element made steady, sustaining and self-possessed. Crowley seats her on a throne of flame with a leopard at her hand, a wand topped with a pine-cone, her crown rayed like the sun: heat that persists rather than flares. The card suggests authority that is warm at a distance and fierce up close; consider what steady force is holding this matter together, and how it responds to challenge.',
    symbolism:
      'A crowned queen enthroned amid flames, a leopard beneath her outstretched hand, the pine-cone wand upright, her long hair and the flames around her forming one continuous blaze.',
  }),
  TC({
    ...W,
    rank: 'Knight',
    rankIndex: 3,
    astrology: 'Fire of Fire',
    correspondences: {
      sub_element: 'fire',
      rulership: '20° Scorpio – 20° Sagittarius',
      esoteric_title: 'Lord of the Flame and the Lightning, King of the Spirits of Fire',
    },
    up: ['fire of fire', 'the black horse', 'the torch', 'activity at its height', 'lightning'],
    meaning:
      'The Knight of Wands is fire of fire: the most active card in the deck, a rider on a black horse leaping through flame with a torch in hand and a unicorn crest on the helm — Crowley notes that his energy is so pure it cannot last long. In the Thoth court the Knight is the highest rank, the mounted Yod of the suit. The card suggests a decisive, generous, quickly spent force; one way to read it is to ask what will remain when the charge has passed.',
    symbolism:
      'A mounted knight in armour of flame, torch raised, on a rearing black horse, the whole figure and background sheeted in fire, a unicorn horn on the helm.',
  }),
];

export const THOTH_CUPS: CardSeed[] = [
  TP({
    ...C,
    number: 1,
    title: null,
    astrology: 'Root of the Powers of Water',
    correspondences: { sephira: 'Kether', esoteric_title: 'Root of the Powers of Water' },
    up: [
      'primal water',
      'the Grail',
      'Kether in Briah',
      'receptivity before feeling',
      'the lotus cup',
    ],
    meaning:
      'The Ace of Cups is water in Kether — the Holy Grail itself, a cup shaped like the lotus rising from a dark sea, with a single ray of light entering from above. Crowley describes it as the feminine complement of the Ace of Wands: capacity, receptivity, the vessel before anything has been poured into it. The card suggests an opening of the heart or the imagination at its source; ask what you are now able to receive that you could not before.',
    symbolism:
      'A great cup formed of lotus petals rising on a stem from a dark sea, three rings of light within it, a single beam descending from the top of the card, waves and the letters of the name around.',
  }),
  TP({
    ...C,
    number: 2,
    title: 'Love',
    astrology: 'Venus in Cancer',
    correspondences: {
      sephira: 'Chokmah',
      decan: 'Venus in Cancer · 1st decan',
      planet: 'Venus',
      zodiac: 'Cancer',
      esoteric_title: 'Lord of Love',
    },
    up: [
      'love',
      'the two dolphins',
      'Venus in Cancer',
      'the lotus overflowing',
      'harmony of the two',
    ],
    meaning:
      'Love is Chokmah of water: two cups filled from one lotus by the twin dolphins of Venus, the water pouring in perfect symmetry into a calm green sea. Crowley calls this the best card in the suit — will and understanding in harmony, nothing yet lost. The card suggests a bond in which giving and receiving are the same movement; consider where such a balance exists in your life now and what feeds it.',
    symbolism:
      'Two cups on a still sea, a lotus rising between them, two intertwined dolphins pouring streams from its blossom into both cups, all in the green and rose of Venus in Cancer.',
  }),
  TP({
    ...C,
    number: 3,
    title: 'Abundance',
    astrology: 'Mercury in Cancer',
    correspondences: {
      sephira: 'Binah',
      decan: 'Mercury in Cancer · 2nd decan',
      planet: 'Mercury',
      zodiac: 'Cancer',
      esoteric_title: 'Lord of Abundance',
    },
    up: [
      'abundance',
      'the pomegranate cups',
      'Binah of water',
      'fulfilment that will pass',
      'Demeter and Persephone',
    ],
    meaning:
      'Abundance is Binah of water: three cups shaped as pomegranates, overflowing from a single lotus, Mercury in Cancer lending the pleasure a certain quickness. Crowley warns that the fruit is Persephone’s — a fulfilment already promised to the underworld, delight that carries the seed of its own ending. The card suggests plenty enjoyed in the present tense; one way to read it is to take the abundance fully while recognising that it belongs to a season.',
    symbolism:
      'Three pomegranate-shaped cups on a calm golden sea, water spilling from one to the next, lotus stems rising behind, in the ripe yellows and greens of the decan.',
  }),
  TP({
    ...C,
    number: 4,
    title: 'Luxury',
    astrology: 'Moon in Cancer',
    correspondences: {
      sephira: 'Chesed',
      decan: 'Moon in Cancer · 3rd decan',
      planet: 'Moon',
      zodiac: 'Cancer',
      esoteric_title: 'Lord of Blended Pleasure',
    },
    up: [
      'luxury',
      'pleasure begun to sag',
      'Chesed of water',
      'the sea gone turbid',
      'the Moon in Cancer',
    ],
    meaning:
      'Luxury is Chesed of water, and Crowley takes the word in its Latin sense of excess rather than comfort: four cups still fed by the lotus, but the sea has turned murky and the stem grows less freely. Pleasure has become habit. The card suggests a satisfaction that is real but no longer nourishing; consider what you are continuing to take because it was once good, and whether it still is.',
    symbolism:
      'Four square-shaped cups in two tiers on a heavy, clouded sea, a lotus pouring into the upper pair, the stems bent, the colours of the picture deepened toward a bruised blue.',
  }),
  TP({
    ...C,
    number: 5,
    title: 'Disappointment',
    astrology: 'Mars in Scorpio',
    correspondences: {
      sephira: 'Geburah',
      decan: 'Mars in Scorpio · 1st decan',
      planet: 'Mars',
      zodiac: 'Scorpio',
      esoteric_title: 'Lord of Loss in Pleasure',
    },
    up: [
      'disappointment',
      'the inverted pentagram',
      'Mars in Scorpio',
      'lotus without water',
      'Geburah of water',
    ],
    meaning:
      'Disappointment is Geburah of water: five empty cups laid out as an inverted pentagram, the lotus withered, no water flowing anywhere, Mars in Scorpio adding a bitter edge. Crowley is exact about the feeling — not grief but the discovery that what was expected will not come. The card suggests a let-down whose cause is in the nature of the thing hoped for; ask what the expectation was built on, and whether anything can still be drawn from the dry cups.',
    symbolism:
      'Five empty cups arranged as a downward-pointing star on a stagnant sea, the lotus stems dry and drooping, the sky the dull red and yellow of Mars in Scorpio.',
  }),
  TP({
    ...C,
    number: 6,
    title: 'Pleasure',
    astrology: 'Sun in Scorpio',
    correspondences: {
      sephira: 'Tiphareth',
      decan: 'Sun in Scorpio · 2nd decan',
      planet: 'Sun',
      zodiac: 'Scorpio',
      esoteric_title: 'Lord of Pleasure',
    },
    up: [
      'pleasure',
      'Tiphareth of water',
      'fulfilment of the sexual will',
      'the copper cups',
      'harmony of feeling',
    ],
    meaning:
      'Pleasure is Tiphareth of water — the suit at its most balanced, six copper cups fed by the lotus in orderly streams, the Sun in Scorpio bringing warmth to the depths. Crowley’s meaning is fulfilment in the fullest sense: well-being, the harmony of desire and its object, without the sagging of Luxury or the bitterness of Disappointment. The card suggests genuine delight; consider what makes this pleasure sustainable where others were not.',
    symbolism:
      'Six copper cups, each with a lotus stem pouring water into it, on a golden sea, the stems rising from a single root, in the honeyed oranges of the Sun in Scorpio.',
  }),
  TP({
    ...C,
    number: 7,
    title: 'Debauch',
    astrology: 'Venus in Scorpio',
    correspondences: {
      sephira: 'Netzach',
      decan: 'Venus in Scorpio · 3rd decan',
      planet: 'Venus',
      zodiac: 'Scorpio',
      esoteric_title: 'Lord of Illusionary Success',
    },
    up: [
      'debauch',
      'the poisoned lotuses',
      'Venus in Scorpio',
      'pleasure gone rotten',
      'Netzach of water',
    ],
    meaning:
      'Debauch is Netzach of water: seven cups from which slime rather than water drips, the lotuses turned to tiger-lilies, the sea a swamp — Venus in Scorpio, love in the sign of decay. Crowley reads it as pleasure pursued past the point where it gives anything back. The card suggests a craving that no longer satisfies; ask what you are trying to recapture and whether the well has simply been drunk dry.',
    symbolism:
      'Seven cups in a downward pattern, green-black liquid oozing over their rims, the lotus blossoms replaced by poisonous lilies, the sea below turned to marsh.',
  }),
  TP({
    ...C,
    number: 8,
    title: 'Indolence',
    astrology: 'Saturn in Pisces',
    correspondences: {
      sephira: 'Hod',
      decan: 'Saturn in Pisces · 1st decan',
      planet: 'Saturn',
      zodiac: 'Pisces',
      esoteric_title: 'Lord of Abandoned Success',
    },
    up: ['indolence', 'the stagnant pools', 'Saturn in Pisces', 'effort abandoned', 'Hod of water'],
    meaning:
      'Indolence is Hod of water: eight cups standing in shallow, stagnant pools, two lotuses drooping with the little water they have, Saturn weighing on the most fluid of signs. Crowley’s phrase is abandoned success — a matter given up not because it failed but because the energy to continue drained away. The card suggests apathy in place of decision; consider what you have stopped tending and whether the reason is exhaustion or a change of heart.',
    symbolism:
      'Eight cups in shallow water among dark rocks, the two lotus stems bent low and pouring only a trickle, the sky a heavy sunset yellow over a leaden sea.',
  }),
  TP({
    ...C,
    number: 9,
    title: 'Happiness',
    astrology: 'Jupiter in Pisces',
    correspondences: {
      sephira: 'Yesod',
      decan: 'Jupiter in Pisces · 2nd decan',
      planet: 'Jupiter',
      zodiac: 'Pisces',
      esoteric_title: 'Lord of Material Happiness',
    },
    up: [
      'happiness',
      'Yesod of water',
      'the nine lotuses',
      'Jupiter in Pisces',
      'complete satisfaction',
    ],
    meaning:
      'Happiness is Yesod of water: nine cups in a square of three, each fed by its own lotus, the water flowing evenly in every direction, Jupiter generous in Pisces. Crowley calls it the most complete pleasure of the suit — contentment that has found a stable foundation. The card suggests a happiness that does not depend on more arriving; one way to read it is to notice the moment as full, and to resist the reflex of asking what comes next.',
    symbolism:
      'Nine cups arranged in a square, nine lotus blossoms pouring into them, water overflowing from every rim into a calm violet-and-blue sea.',
  }),
  TP({
    ...C,
    number: 10,
    title: 'Satiety',
    astrology: 'Mars in Pisces',
    correspondences: {
      sephira: 'Malkuth',
      decan: 'Mars in Pisces · 3rd decan',
      planet: 'Mars',
      zodiac: 'Pisces',
      esoteric_title: 'Lord of Perfected Success',
    },
    up: [
      'satiety',
      'the Tree of Life in cups',
      'Mars in Pisces',
      'fullness that unsettles',
      'Malkuth of water',
    ],
    meaning:
      'Satiety is Malkuth of water: ten cups laid out as the Tree of Life, overflowing, but set at an angle as if the whole structure might tip — Mars in Pisces bringing a restless, disruptive note to completion. Crowley observes that the work is done and the pleasure fulfilled, and that the fulfilment itself now unbalances the picture. The card suggests having enough and finding that this is not quite rest; consider what the fullness is asking you to do with it.',
    symbolism:
      'Ten cups in the pattern of the Tree of Life, each overflowing, the lotus rising behind them, the arrangement tilted and the water spilling past the edges of the frame.',
  }),
  TC({
    ...C,
    rank: 'Princess',
    rankIndex: 0,
    astrology: 'Earth of Water',
    correspondences: {
      sub_element: 'earth',
      rulership: 'The quadrant Libra–Scorpio–Sagittarius (the Pacific)',
      esoteric_title: 'Princess of the Waters, Lotus of the Palace of the Floods',
    },
    up: [
      'earth of water',
      'the swan and the tortoise',
      'crystallised feeling',
      'the dolphin',
      'dreaming made concrete',
    ],
    meaning:
      'The Princess of Cups is earth of water — feeling made concrete, water at the point of crystallising. Crowley draws her in a flowing robe with a swan crest, holding a shell-cup from which a tortoise emerges, a dolphin leaping beside her: the imagination at the moment it produces something one can touch. The card suggests tenderness, romance and the beginnings of creative work; consider what dream is asking to be made real, and whether you have given it a body.',
    symbolism:
      'A dancing figure crowned with a swan, robes crystalline and rippling, a lotus-shaped cup with a tortoise inside, a dolphin curling at her side, waves and ice around her.',
  }),
  TC({
    ...C,
    rank: 'Prince',
    rankIndex: 1,
    astrology: 'Air of Water',
    correspondences: {
      sub_element: 'air',
      rulership: '20° Libra – 20° Scorpio',
      esoteric_title: 'Prince of the Chariot of the Waters',
    },
    up: [
      'air of water',
      'the eagle-drawn chariot',
      'the serpent in the cup',
      'hidden intensity',
      'Scorpio’s depths',
    ],
    meaning:
      'The Prince of Cups is air of water — feeling given intellect and direction, drawn in his chariot by an eagle, holding a lotus in one hand and in the other a cup from which a serpent rises. Crowley describes a nature of great subtlety and secret violence: calm on the surface, with Scorpio underneath. The card suggests emotion managed by a strong mind, which is both its gift and its danger; ask what lies beneath the composure you are seeing, in yourself or another.',
    symbolism:
      'A crowned prince in a shell chariot drawn by an eagle, a lotus flower in one hand and a cup with a coiled serpent in the other, the scene set over deep still water.',
  }),
  TC({
    ...C,
    rank: 'Queen',
    rankIndex: 2,
    astrology: 'Water of Water',
    correspondences: {
      sub_element: 'water',
      rulership: '20° Gemini – 20° Cancer',
      esoteric_title: 'Queen of the Thrones of the Waters',
    },
    up: [
      'water of water',
      'the reflecting surface',
      'the ibis and the crayfish',
      'pure receptivity',
      'the veiled queen',
    ],
    meaning:
      'The Queen of Cups is water of water: pure reflection, so receptive that her form is hard to make out behind the veils of light and the surface of the pool. Crowley gives her the ibis of Thoth, the crayfish of the Moon and a shell-cup holding the lotus, and warns that what one sees in her is largely oneself. The card suggests a receptivity that mirrors whatever approaches it; consider what you are projecting onto the situation and what the still surface is actually showing.',
    symbolism:
      'A seated queen almost dissolved in rippling curtains of light, an ibis on her hand and a crayfish at her feet, a shell-shaped cup enclosing a lotus, the whole picture a play of reflections on water.',
  }),
  TC({
    ...C,
    rank: 'Knight',
    rankIndex: 3,
    astrology: 'Fire of Water',
    correspondences: {
      sub_element: 'fire',
      rulership: '20° Aquarius – 20° Pisces',
      esoteric_title: 'Lord of the Waves and the Waters, King of the Hosts of the Sea',
    },
    up: [
      'fire of water',
      'the white horse over the sea',
      'the peacock',
      'the crab in the cup',
      'rain and springs',
    ],
    meaning:
      'The Knight of Cups is fire of water — the active, generative force within the emotional element, a winged rider on a white horse leaping over the sea with a cup from which a crab rises, the peacock of Juno spreading behind. Crowley reads him as swift, enthusiastic and easily distracted: rain that falls hard and passes. The card suggests a rush of feeling that moves things; one way to read it is to enjoy the freshness while asking what will remain when it has passed.',
    symbolism:
      'A winged knight in armour of pale water leaping a white horse across a dark sea, a cup raised with a crab emerging, a peacock with fanned tail behind him.',
  }),
];
