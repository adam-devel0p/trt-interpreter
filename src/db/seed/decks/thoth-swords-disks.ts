import type { CardSeed } from '@/domain/decks/types';
import { court, pip } from './_builders';

/** Thoth Swords (air) and Disks (earth). Sort blocks: swords 50–63, disks 64–77. */
type PipIn = Parameters<typeof pip>[0];
type CourtIn = Parameters<typeof court>[0];
const TP = (i: Omit<PipIn, 'reversed' | 'rev'>) => pip({ ...i, reversed: null, rev: [] });
const TC = (i: Omit<CourtIn, 'reversed' | 'rev'>) => court({ ...i, reversed: null, rev: [] });

const S = { suit: 'swords', suitLabel: 'Swords', base: 50 } as const;
const D = { suit: 'disks', suitLabel: 'Disks', base: 64 } as const;

export const THOTH_SWORDS: CardSeed[] = [
  TP({
    ...S,
    number: 1,
    title: null,
    astrology: 'Root of the Powers of Air',
    correspondences: { sephira: 'Kether', esoteric_title: 'Root of the Powers of Air' },
    up: [
      'primal air',
      'the sword through the crown',
      'Kether in Yetzirah',
      'invoked force',
      'the word Thelema',
    ],
    meaning:
      'The Ace of Swords is air in Kether: a green-hilted sword rising into a crown of twenty-two rays, the word Thelema engraved on the blade, the clouds of chaos breaking around it. Crowley describes it as invoked force — the mind at the moment it becomes a weapon, before it has chosen a target. The card suggests an idea powerful enough to cut in either direction; ask what it is being called to serve.',
    symbolism:
      'An upright sword piercing a radiant crown, its blade inscribed with a Greek word, the sun behind the crown and dark clouds parting on either side, the point of the sword resting in a sea of light.',
  }),
  TP({
    ...S,
    number: 2,
    title: 'Peace',
    astrology: 'Moon in Libra',
    correspondences: {
      sephira: 'Chokmah',
      decan: 'Moon in Libra · 1st decan',
      planet: 'Moon',
      zodiac: 'Libra',
      esoteric_title: 'Lord of Peace Restored',
    },
    up: ['peace', 'the blue rose', 'two swords at rest', 'Moon in Libra', 'Chokmah of air'],
    meaning:
      'Peace is Chokmah of air: two swords crossed through a blue rose of five petals, their points meeting in a geometric balance, the Moon in Libra. Crowley calls the peace a real one but notes that in the suit of swords even harmony is a poise between forces — the rose holds the blades apart. The card suggests a mind at rest after conflict; consider what balance is holding the calm and how much it depends on nothing moving.',
    symbolism:
      'Two swords crossed at the centre of a five-petalled blue rose, radiating lines of light from the meeting point, pinwheel shapes and the crescent moon in the corners, on a field of pale green.',
  }),
  TP({
    ...S,
    number: 3,
    title: 'Sorrow',
    astrology: 'Saturn in Libra',
    correspondences: {
      sephira: 'Binah',
      decan: 'Saturn in Libra · 2nd decan',
      planet: 'Saturn',
      zodiac: 'Libra',
      esoteric_title: 'Lord of Sorrow',
    },
    up: [
      'sorrow',
      'the rose torn apart',
      'Binah of air',
      'the Great Mother’s grief',
      'Saturn in Libra',
    ],
    meaning:
      'Sorrow is Binah of air: the great sword of the Mother with two smaller swords crossed behind it, tearing the rose of Peace to petals against a dark storm. Crowley’s sorrow is not personal misery but the sorrow of understanding itself — Binah, who sees the whole and knows what it costs. The card suggests grief that comes with clear sight; one way to read it is that what you are feeling is the price of finally seeing a thing entire.',
    symbolism:
      'A large central sword point-down with two smaller swords crossing it, a rose broken into falling petals at their intersection, a heavy dark sky with geometric storm-shapes behind.',
  }),
  TP({
    ...S,
    number: 4,
    title: 'Truce',
    astrology: 'Jupiter in Libra',
    correspondences: {
      sephira: 'Chesed',
      decan: 'Jupiter in Libra · 3rd decan',
      planet: 'Jupiter',
      zodiac: 'Libra',
      esoteric_title: 'Lord of Rest from Strife',
    },
    up: [
      'truce',
      'the rose of forty-nine petals',
      'swords in the cross of St Andrew',
      'Chesed of air',
      'an armed calm',
    ],
    meaning:
      'Truce is Chesed of air: four swords with their points meeting at a rose of forty-nine petals, arranged as the cross of St Andrew, Jupiter in Libra granting a settlement. Crowley is careful that this is a truce, not peace — a convention between forces still armed, order established by agreement rather than by resolution. The card suggests a pause that holds while both sides keep it; consider what the agreement is and what would break it.',
    symbolism:
      'Four swords arranged as a saltire, their hilts at the corners and their points meeting in a large rose of many petals, the whole in a calm green and the pale gold of Jupiter.',
  }),
  TP({
    ...S,
    number: 5,
    title: 'Defeat',
    astrology: 'Venus in Aquarius',
    correspondences: {
      sephira: 'Geburah',
      decan: 'Venus in Aquarius · 1st decan',
      planet: 'Venus',
      zodiac: 'Aquarius',
      esoteric_title: 'Lord of Defeat',
    },
    up: [
      'defeat',
      'the inverted pentagram of swords',
      'Venus in Aquarius',
      'weakness in the intellect',
      'Geburah of air',
    ],
    meaning:
      'Defeat is Geburah of air: five swords of different, damaged shapes with their hilts forming an inverted pentagram, the rose dissolved into blood-red petals falling between them, Venus weak in the cold sign. Crowley reads the defeat as intellectual and moral — a failure of nerve or of honesty rather than a loss to a stronger foe. The card suggests being beaten from within; ask where reasoning gave way to something smaller.',
    symbolism:
      'Five mismatched swords, some bent or broken, hilts arranged as a downward pentagram, red petals drifting through them, the background a sickly green under a dark sky.',
  }),
  TP({
    ...S,
    number: 6,
    title: 'Science',
    astrology: 'Mercury in Aquarius',
    correspondences: {
      sephira: 'Tiphareth',
      decan: 'Mercury in Aquarius · 2nd decan',
      planet: 'Mercury',
      zodiac: 'Aquarius',
      esoteric_title: 'Lord of Earned Success',
    },
    up: [
      'science',
      'the Rose-cross',
      'Tiphareth of air',
      'Mercury in Aquarius',
      'intellect in balance',
    ],
    meaning:
      'Science is Tiphareth of air: six swords meeting at a Rose-cross, their points touching a rose of six petals, Mercury clear in Aquarius. Crowley uses the word for the intellect operating at its best — balanced, objective, effective, the mind that has earned its success. The card suggests a problem yielding to method; consider what becomes possible when thought is disciplined and unafraid.',
    symbolism:
      'Six swords whose points converge on a small rose set within a cross, the hilts fanned around the edge, geometric figures of the mind in the background in the yellows and blues of Mercury.',
  }),
  TP({
    ...S,
    number: 7,
    title: 'Futility',
    astrology: 'Moon in Aquarius',
    correspondences: {
      sephira: 'Netzach',
      decan: 'Moon in Aquarius · 3rd decan',
      planet: 'Moon',
      zodiac: 'Aquarius',
      esoteric_title: 'Lord of Unstable Effort',
    },
    up: [
      'futility',
      'the six planets against the sun-sword',
      'Moon in Aquarius',
      'effort that cannot hold',
      'Netzach of air',
    ],
    meaning:
      'Futility is Netzach of air: one large sword bearing the sun, its point pressed by six smaller swords marked with the planets, the Moon in Aquarius sapping resolve. Crowley reads it as a policy of appeasement — compromise where struggle would be honest, effort dissipated among too many small concessions. The card suggests a plan that keeps yielding ground; ask what the single strong intention was, and what has been bargained away from it.',
    symbolism:
      'A central sword hilted with the sun, its point meeting the points of six shorter swords tipped with planetary sigils, on a field of ragged blue and mauve.',
  }),
  TP({
    ...S,
    number: 8,
    title: 'Interference',
    astrology: 'Jupiter in Gemini',
    correspondences: {
      sephira: 'Hod',
      decan: 'Jupiter in Gemini · 1st decan',
      planet: 'Jupiter',
      zodiac: 'Gemini',
      esoteric_title: 'Lord of Shortened Force',
    },
    up: [
      'interference',
      'the six alien blades',
      'Jupiter in Gemini',
      'will thwarted by accident',
      'Hod of air',
    ],
    meaning:
      'Interference is Hod of air: two long swords crossed by six short, foreign-shaped weapons — kris, scimitar, dagger — Jupiter unlucky in Gemini. Crowley’s reading is of will shortened by unforeseen interruption, energy cut across by accident and detail rather than by opposition. The card suggests a matter tangled in small obstructions; consider whether the interference is external or a habit of your own attention.',
    symbolism:
      'Two long swords crossed vertically, six oddly shaped blades laid across them at angles, the whole caught in a lattice of lines against a purple-blue background.',
  }),
  TP({
    ...S,
    number: 9,
    title: 'Cruelty',
    astrology: 'Mars in Gemini',
    correspondences: {
      sephira: 'Yesod',
      decan: 'Mars in Gemini · 2nd decan',
      planet: 'Mars',
      zodiac: 'Gemini',
      esoteric_title: 'Lord of Despair and Cruelty',
    },
    up: [
      'cruelty',
      'the nine rusted swords',
      'Mars in Gemini',
      'the mind turned against itself',
      'Yesod of air',
    ],
    meaning:
      'Cruelty is Yesod of air: nine jagged swords pointing downward, dripping blood and poison, Mars in Gemini turning the intellect into an instrument of torment. Crowley locates the cruelty in consciousness — the mind that has abandoned reason for the pleasure of wounding, most often itself. The card suggests a merciless inner voice or a brutal external one; ask who is holding the blade and whether the verdict is reasoned or merely repeated.',
    symbolism:
      'Nine rusted, notched swords hanging point-down, blood and venom dripping from them, against a background of crystalline dark shapes and a red sky.',
  }),
  TP({
    ...S,
    number: 10,
    title: 'Ruin',
    astrology: 'Sun in Gemini',
    correspondences: {
      sephira: 'Malkuth',
      decan: 'Sun in Gemini · 3rd decan',
      planet: 'Sun',
      zodiac: 'Gemini',
      esoteric_title: 'Lord of Ruin',
    },
    up: [
      'ruin',
      'the shattered heart',
      'the Tree of Life in swords',
      'Sun in Gemini',
      'Malkuth of air',
    ],
    meaning:
      'Ruin is Malkuth of air: ten swords arranged as the Tree of Life with the heart at Tiphareth pierced and broken, the Sun in Gemini illuminating the collapse of reason into pure disruption. Crowley notes the paradox that the Sun should preside over ruin — the intellect has reached its end and has nothing left but to destroy its own structure. The card suggests an idea or an argument that has run itself into the ground; consider what remains once the reasoning has failed completely.',
    symbolism:
      'Ten swords laid out in the pattern of the Tree of Life, the sixth piercing a heart that splinters at the centre, the blades broken and scattered, a harsh yellow light behind.',
  }),
  TC({
    ...S,
    rank: 'Princess',
    rankIndex: 0,
    astrology: 'Earth of Air',
    correspondences: {
      sub_element: 'earth',
      rulership: 'The quadrant Capricorn–Aquarius–Pisces (the Americas)',
      esoteric_title: 'Princess of the Rushing Winds, Lotus of the Palace of Air',
    },
    up: [
      'earth of air',
      'Minerva',
      'the sword striking the altar',
      'practical intellect',
      'the storm made concrete',
    ],
    meaning:
      'The Princess of Swords is earth of air — thought brought down into action, Minerva in aggressive stance with a sword raised against an altar and the Medusa crest on her helmet, clouds rolling behind her. Crowley credits her with a mind that fixes ideas into facts, and with a fierce competence in practical matters. The card suggests intellect applied with force to something concrete; ask what argument is being settled by action, and whether the altar deserved the blow.',
    symbolism:
      'A helmeted figure with the head of Medusa as her crest, sword lifted in both hands over a smoking altar, the clouds behind her whipped into a storm, her stance braced and downward.',
  }),
  TC({
    ...S,
    rank: 'Prince',
    rankIndex: 1,
    astrology: 'Air of Air',
    correspondences: {
      sub_element: 'air',
      rulership: '20° Capricorn – 20° Aquarius',
      esoteric_title: 'Prince of the Chariots of the Winds',
    },
    up: [
      'air of air',
      'the chariot drawn by fairies',
      'sword and sickle',
      'pure intellect',
      'ideas that dissolve',
    ],
    meaning:
      'The Prince of Swords is air of air: pure intellect, in a chariot drawn by three winged figures that pull in different directions, holding a sword in one hand and a sickle in the other — creating an idea and immediately cutting it down. Crowley’s portrait is of great mental power without a governing purpose. The card suggests brilliance that will not settle; consider whether the thinking here is going anywhere or simply enjoying itself.',
    symbolism:
      'A crowned prince in a chariot of geometric shapes drawn by three small winged fairies, a sword raised and a sickle lowered, the background a maze of crystalline forms in the pale greens and yellows of air.',
  }),
  TC({
    ...S,
    rank: 'Queen',
    rankIndex: 2,
    astrology: 'Water of Air',
    correspondences: {
      sub_element: 'water',
      rulership: '20° Virgo – 20° Libra',
      esoteric_title: 'Queen of the Thrones of Air',
    },
    up: [
      'water of air',
      'the severed head',
      'the clear observer',
      'the mask removed',
      'the child’s head as crest',
    ],
    meaning:
      'The Queen of Swords is water of air — perception clarified by feeling, the liberator of the mind. Crowley draws her enthroned on clouds with a sword in one hand and a severed bearded head in the other: the mask of old assumptions cut away. Her crest is a child’s head, her nature clear and keen. The card suggests seeing through appearance without cruelty; consider what illusion is ready to be beheaded and what remains once it is.',
    symbolism:
      'A crowned queen seated on a throne of cloud, a sword pointed downward in one hand, a bearded severed head held by the hair in the other, a child’s head above her crown and cumulus around her.',
  }),
  TC({
    ...S,
    rank: 'Knight',
    rankIndex: 3,
    astrology: 'Fire of Air',
    correspondences: {
      sub_element: 'fire',
      rulership: '20° Taurus – 20° Gemini',
      esoteric_title: 'Lord of the Winds and Breezes, King of the Spirits of Air',
    },
    up: [
      'fire of air',
      'the propeller wings',
      'the charge through storm',
      'sword and dagger',
      'swift decisive thought',
    ],
    meaning:
      'The Knight of Swords is fire of air: the active force within the intellect, a rider with four propeller-like wings charging on a horse through streaming clouds, sword and dagger drawn together. Crowley describes him as fierce, clever and subtle, an attack of pure reasoning delivered at speed. The card suggests a decision made and acted on in the same motion; ask whether the swiftness is clarity or merely momentum.',
    symbolism:
      'An armoured knight on a brown horse, four whirling wings at his back, a sword raised and a dagger held low, clouds torn into streamers around him against a yellow sky.',
  }),
];

export const THOTH_DISKS: CardSeed[] = [
  TP({
    ...D,
    number: 1,
    title: null,
    astrology: 'Root of the Powers of Earth',
    correspondences: { sephira: 'Kether', esoteric_title: 'Root of the Powers of Earth' },
    up: [
      'primal earth',
      'the winged disk',
      'Kether in Assiah',
      'matter as the highest',
      'To Mega Therion',
    ],
    meaning:
      'The Ace of Disks is earth in Kether: a great winged disk engraved with Crowley’s own name and number, the rings of the coin showing the whole universe compressed into matter. He reverses the old contempt for the material — the Ace of Disks is the crown descending into the kingdom, spirit fully incarnate. The card suggests a material beginning with the whole of one’s nature behind it; ask what is being made real and how much of you it contains.',
    symbolism:
      'A large coin with concentric rings of wings, geometric bands and a central seal inscribed with a Greek name and the number 666, set within a green oval of leaves.',
  }),
  TP({
    ...D,
    number: 2,
    title: 'Change',
    astrology: 'Jupiter in Capricorn',
    correspondences: {
      sephira: 'Chokmah',
      decan: 'Jupiter in Capricorn · 1st decan',
      planet: 'Jupiter',
      zodiac: 'Capricorn',
      esoteric_title: 'Lord of Harmonious Change',
    },
    up: [
      'change',
      'the crowned serpent',
      'yin and yang',
      'stability through motion',
      'Chokmah of earth',
    ],
    meaning:
      'Change is Chokmah of earth: two disks marked with the yin-yang symbols, held in the coils of a crowned serpent that forms a figure of eight. Crowley’s point is that in matter, change is the only stability — a thing that stopped changing would cease to exist. Jupiter in Capricorn gives the motion its patient rhythm. The card suggests circumstances turning in a way that keeps them alive; consider what alternation is sustaining the matter, and whether you are fighting it.',
    symbolism:
      'A crowned serpent looped into a lemniscate around two disks, each disk bearing the symbol of the two principles in balance, against a field of green and grey.',
  }),
  TP({
    ...D,
    number: 3,
    title: 'Works',
    astrology: 'Mars in Capricorn',
    correspondences: {
      sephira: 'Binah',
      decan: 'Mars in Capricorn · 2nd decan',
      planet: 'Mars',
      zodiac: 'Capricorn',
      esoteric_title: 'Lord of Material Works',
    },
    up: [
      'works',
      'the pyramid seen from above',
      'Mercury, Sulphur, Salt',
      'Mars exalted in Capricorn',
      'Binah of earth',
    ],
    meaning:
      'Works is Binah of earth: a pyramid seen from above, its three visible faces marked with the alchemical Mercury, Sulphur and Salt, rising from a sea of wheels — Mars exalted in Capricorn, force perfectly engineered. Crowley reads it as the establishment of the Great Work in matter, construction that has a plan. The card suggests effort organised into something that will stand; consider what structure you are building and whether its three principles are in proportion.',
    symbolism:
      'A pyramid viewed from directly above, three wheels at its corners marked with alchemical symbols, set in a grey sea of rotating gears and rays under a red sky.',
  }),
  TP({
    ...D,
    number: 4,
    title: 'Power',
    astrology: 'Sun in Capricorn',
    correspondences: {
      sephira: 'Chesed',
      decan: 'Sun in Capricorn · 3rd decan',
      planet: 'Sun',
      zodiac: 'Capricorn',
      esoteric_title: 'Lord of Earthly Power',
    },
    up: [
      'power',
      'the fortress',
      'the four elements walled',
      'Chesed of earth',
      'law and order in matter',
    ],
    meaning:
      'Power is Chesed of earth: a square fortress with four towers, each marked with an element, seen from above with a moat around it — the Sun in Capricorn, authority made architectural. Crowley reads the card as law, order and dominion, and the fortress as both protection and enclosure. The card suggests security achieved by holding a defined territory; consider what the walls keep out, what they keep in, and whether the gates still open.',
    symbolism:
      'A fortress seen from above, square with four corner towers bearing elemental symbols, a moat and formal grounds around it, in the blue and gold of the decan.',
  }),
  TP({
    ...D,
    number: 5,
    title: 'Worry',
    astrology: 'Mercury in Taurus',
    correspondences: {
      sephira: 'Geburah',
      decan: 'Mercury in Taurus · 1st decan',
      planet: 'Mercury',
      zodiac: 'Taurus',
      esoteric_title: 'Lord of Material Trouble',
    },
    up: [
      'worry',
      'the inverted pentagram of the tattvas',
      'Mercury in Taurus',
      'strain in matter',
      'Geburah of earth',
    ],
    meaning:
      'Worry is Geburah of earth: five disks marked with the tattvas — the Hindu symbols of the elements — arranged as an inverted pentagram, gears grinding behind them, Mercury restless in slow Taurus. Crowley intends the word in its older sense, to worry as a dog worries a bone: a prolonged, grinding strain rather than an anxiety. The card suggests material pressure that never quite resolves; ask what mechanism is turning without producing, and what it is wearing down.',
    symbolism:
      'Five disks bearing the tattva shapes — an egg, a crescent, a triangle, a circle, a square — set as a downward pentagram over a background of meshing gears and strained lines.',
  }),
  TP({
    ...D,
    number: 6,
    title: 'Success',
    astrology: 'Moon in Taurus',
    correspondences: {
      sephira: 'Tiphareth',
      decan: 'Moon in Taurus · 2nd decan',
      planet: 'Moon',
      zodiac: 'Taurus',
      esoteric_title: 'Lord of Material Success',
    },
    up: [
      'success',
      'the six planets around the sun',
      'the Rose-cross',
      'Moon exalted in Taurus',
      'Tiphareth of earth',
    ],
    meaning:
      'Success is Tiphareth of earth: six disks marked with the planets arranged around a central rose-cross bearing the sun, the Moon exalted in Taurus, everything in matter briefly in harmony. Crowley notes that success in the material world is by nature transient — the card shows the moment of balance, not a permanent state. The card suggests a genuine achievement enjoyed at its height; one way to read it is to receive it fully while knowing the wheel will turn.',
    symbolism:
      'Six disks bearing planetary sigils set in a hexagon around a central rose-cross with the sun at its heart, the whole in the amber and rose of a harvest moon.',
  }),
  TP({
    ...D,
    number: 7,
    title: 'Failure',
    astrology: 'Saturn in Taurus',
    correspondences: {
      sephira: 'Netzach',
      decan: 'Saturn in Taurus · 3rd decan',
      planet: 'Saturn',
      zodiac: 'Taurus',
      esoteric_title: 'Lord of Success Unfulfilled',
    },
    up: ['failure', 'the blighted crop', 'Saturn in Taurus', 'leaden disks', 'Netzach of earth'],
    meaning:
      'Failure is Netzach of earth: seven leaden disks marked with the sign of Saturn and Taurus, laid on a field of dead vegetation in the geomantic figure Rubeus — Saturn stifling the fertility of the bull. Crowley reads it as blight: the crop that will not come in, labour that yields nothing. The card suggests an effort whose conditions have turned against it; consider whether more work will change the weather or whether the season is simply lost.',
    symbolism:
      'Seven dull coins stamped with the sigils of Saturn and Taurus, scattered on a ground of withered leaves and stems, the colours the greys and dead greens of frost.',
  }),
  TP({
    ...D,
    number: 8,
    title: 'Prudence',
    astrology: 'Sun in Virgo',
    correspondences: {
      sephira: 'Hod',
      decan: 'Sun in Virgo · 1st decan',
      planet: 'Sun',
      zodiac: 'Virgo',
      esoteric_title: 'Lord of Prudence',
    },
    up: ['prudence', 'the flowering tree', 'Sun in Virgo', 'care for the small', 'Hod of earth'],
    meaning:
      'Prudence is Hod of earth: a tree bearing eight disks as blossoms, each protected by its leaves, the Sun in Virgo attending to detail. Crowley’s prudence is the intelligence of the gardener — patience, husbandry, knowing what to tend and what to leave. The card suggests careful stewardship of something that is growing slowly; ask what small thing needs attention now so that it can become large later.',
    symbolism:
      'A great tree with eight flowers, each a disk sheltered within petals and leaves, roots spreading below, the whole in the warm greens and golds of late summer.',
  }),
  TP({
    ...D,
    number: 9,
    title: 'Gain',
    astrology: 'Venus in Virgo',
    correspondences: {
      sephira: 'Yesod',
      decan: 'Venus in Virgo · 2nd decan',
      planet: 'Venus',
      zodiac: 'Virgo',
      esoteric_title: 'Lord of Material Gain',
    },
    up: [
      'gain',
      'the three magnetic disks',
      'Venus in Virgo',
      'good fortune consolidated',
      'Yesod of earth',
    ],
    meaning:
      'Gain is Yesod of earth: nine disks, six in a ring bearing planetary figures and three at the centre marked with the faces of the moon, Venus refined by Virgo’s care. Crowley reads it as material good fortune that has been consolidated rather than merely received — increase that has found a stable base. The card suggests things going well in a practical, cumulative way; consider what habits are compounding in your favour.',
    symbolism:
      'Nine disks: a central triad with faces of the moon, surrounded by six larger disks marked with planetary symbols, rays linking them, in the rose and green of Venus in Virgo.',
  }),
  TP({
    ...D,
    number: 10,
    title: 'Wealth',
    astrology: 'Mercury in Virgo',
    correspondences: {
      sephira: 'Malkuth',
      decan: 'Mercury in Virgo · 3rd decan',
      planet: 'Mercury',
      zodiac: 'Virgo',
      esoteric_title: 'Lord of Wealth',
    },
    up: [
      'wealth',
      'the Tree of Life in coins',
      'Mercury in Virgo',
      'matter at its fullest',
      'Malkuth of earth',
    ],
    meaning:
      'Wealth is Malkuth of earth: ten disks laid out as the Tree of Life, each a coin stamped with Mercurial symbols, the tenth larger and dominant — matter at its utmost density, the whole Tree realised in the kingdom. Crowley observes that wealth so complete becomes inert unless it is put back into circulation; the card is the end of the suit and asks for a new beginning. It suggests accumulated substance that must now be used or it will weigh; consider what your resources are for.',
    symbolism:
      'Ten coins in the arrangement of the Tree of Life, each stamped with a different Mercurial design, the lowest coin largest, against a dense field of geometric ornament in gold and green.',
  }),
  TC({
    ...D,
    rank: 'Princess',
    rankIndex: 0,
    astrology: 'Earth of Earth',
    correspondences: {
      sub_element: 'earth',
      rulership: 'The quadrant Aries–Taurus–Gemini (Europe and Africa)',
      esoteric_title: 'Princess of the Echoing Hills, Rose of the Palace of Earth',
    },
    up: [
      'earth of earth',
      'the pregnant priestess',
      'the sceptre and the seed',
      'the threshold of the Great Work',
      'matter about to give birth',
    ],
    meaning:
      'The Princess of Disks is earth of earth, the final card of the deck: a robed figure in a grove of bare trees, crowned with ram’s horns, holding a disk that shows the Chinese symbol of the seed and a sceptre tipped with a diamond, visibly pregnant. Crowley calls her the threshold of transformation — matter at the point of becoming spirit again, the cycle closing on its own beginning. The card suggests a slow, decisive, practical fertility; consider what is about to be born from the work already done.',
    symbolism:
      'A woman in a heavy fur-lined robe standing among leafless trees, a ram’s-horn crown on her head, a sceptre with a diamond point in one hand and a disk with a seed-symbol in the other, an altar of wheat before her.',
  }),
  TC({
    ...D,
    rank: 'Prince',
    rankIndex: 1,
    astrology: 'Air of Earth',
    correspondences: {
      sub_element: 'air',
      rulership: '20° Aries – 20° Taurus',
      esoteric_title: 'Prince of the Chariot of Earth',
    },
    up: [
      'air of earth',
      'the bull-drawn chariot',
      'the orb of the cross',
      'steady competence',
      'the fruiting landscape',
    ],
    meaning:
      'The Prince of Disks is air of earth — the mind applied to matter, seated in a chariot drawn by a bull, holding an orb marked with the cross and a sceptre topped with another orb, the landscape around him heavy with fruit and flowers. Crowley describes him as steady, industrious and slow to move, with a capable intelligence that shows in results rather than in talk. The card suggests deliberate, well-founded management; consider what would grow if you simply kept doing the work.',
    symbolism:
      'A crowned prince in a chariot of solid form drawn by a bull, an orb bearing a cross in one hand and a sceptre with a globe in the other, blossoms, wheat and fruit filling the background.',
  }),
  TC({
    ...D,
    rank: 'Queen',
    rankIndex: 2,
    astrology: 'Water of Earth',
    correspondences: {
      sub_element: 'water',
      rulership: '20° Sagittarius – 20° Capricorn',
      esoteric_title: 'Queen of the Thrones of Earth',
    },
    up: [
      'water of earth',
      'the desert made fertile',
      'the goat and the spiral horns',
      'the sphere of the cube',
      'quiet abundance',
    ],
    meaning:
      'The Queen of Disks is water of earth — matter made fertile by feeling, a crowned figure with spiralling horns looking back over a desert toward a river that has begun to green it, a goat resting beside her, a sceptre with a cube in her hand. Crowley calls her the fruitful receptacle of the earth: passive in appearance, generous in result. The card suggests abundance that arrives by patience and care rather than by effort; consider what dry ground in your life has quietly started to grow.',
    symbolism:
      'A queen enthroned on a rocky ledge, her crown rising in great spiral horns, a goat beside her, a sceptre tipped with a cube in one hand and a disk in the other, the desert behind her cut by a winding river with the first green along its banks.',
  }),
  TC({
    ...D,
    rank: 'Knight',
    rankIndex: 3,
    astrology: 'Fire of Earth',
    correspondences: {
      sub_element: 'fire',
      rulership: '20° Leo – 20° Virgo',
      esoteric_title: 'Lord of the Wide and Fertile Land, King of the Spirits of Earth',
    },
    up: [
      'fire of earth',
      'the farmer knight',
      'the flail and the disk',
      'the stag crest',
      'the ripened field',
    ],
    meaning:
      'The Knight of Disks is fire of earth — energy directed into cultivation, an armoured farmer on a heavy horse among ripening wheat, a flail in one hand and a disk marked with the sun in the other, a stag’s head on his helm. Crowley describes him as patient, dull to those who want excitement, and utterly effective within his own field. The card suggests steady productive force; one way to read it is to ask what simply needs to be harvested, and to do that rather than seek something new.',
    symbolism:
      'A knight in dark armour with a stag’s head crest, mounted on a heavy horse in a field of ripe wheat, a flail raised and a disk bearing a solar face held before him, the light of late afternoon on everything.',
  }),
];
