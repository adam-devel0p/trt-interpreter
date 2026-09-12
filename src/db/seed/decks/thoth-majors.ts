import type { CardSeed } from '@/domain/decks/types';
import { major } from './_builders';

/**
 * Thoth Atu (trumps). Names are Crowley's: Adjustment (VIII), Lust (XI), Art (XIV), The Aeon
 * (XX), The Universe (XXI), The Magus, The Priestess, Fortune. Attributions follow *The Book
 * of Thoth* (Hebrew letter, path, planet/sign), including the Heh/Tzaddi exchange between The
 * Star and The Emperor. Thoth practice reads by dignity and position, so `reversed` is null.
 */
type MajorIn = Parameters<typeof major>[0];
const T = (i: Omit<MajorIn, 'reversed' | 'rev'>) => major({ ...i, reversed: null, rev: [] });

export const THOTH_MAJORS: CardSeed[] = [
  T({
    number: 0,
    name: 'The Fool',
    element: 'air',
    astrology: 'Air',
    correspondences: {
      element: 'air',
      hebrew_letter: 'Aleph',
      hebrew_letter_meaning: 'ox',
      path: 11,
      esoteric_title: 'The Spirit of Æthyr',
    },
    up: [
      'the naught',
      'divine folly',
      'pure potential',
      'Harpocrates',
      'the leap into manifestation',
    ],
    meaning:
      'In the Thoth system the Fool is the Naught — the air before breath, the zero from which the whole Tree unfolds. Crowley draws him as the Green Man, Dionysus and Harpocrates at once: divine madness, innocence that has never been tested because nothing yet exists to test it. In a reading the Atu suggests an original impulse that cannot be judged by ordinary standards; one way to hold it is as an invitation to begin without the burden of knowing how it ends.',
    symbolism:
      'A horned figure in green strides through a spiral of light, the sun at the groin, a crocodile and a tiger at the feet, the dove and the vulture above, a caduceus, grapes, coins and the butterfly all caught up in the rush — every image of creation crowded into one breath.',
  }),
  T({
    number: 1,
    name: 'The Magus',
    element: 'air',
    astrology: 'Mercury',
    correspondences: {
      element: 'air',
      planet: 'Mercury',
      hebrew_letter: 'Beth',
      hebrew_letter_meaning: 'house',
      path: 12,
      esoteric_title: 'The Magus of Power',
    },
    up: ['the Word', 'communication', 'juggling the elements', 'skill', 'the trickster'],
    meaning:
      'The Magus is Mercury as the Word: Logos, messenger and juggler, the one who keeps wand, cup, sword and disk in the air along with the stylus and the winged egg. Crowley insists on his ambivalence — the same faculty that transmits truth can lie fluently, and the cynocephalus ape at his heel is the shadow of every word spoken. The card suggests intelligence in motion; ask whether it is being used to reveal or to dazzle.',
    symbolism:
      'A golden figure poised on one foot, hands raised, the four weapons and the pen and papyrus in orbit around him, wings at the shoulders, the caduceus above and the ape of Thoth below — communication as a dance that never lands.',
  }),
  T({
    number: 2,
    name: 'The Priestess',
    element: 'water',
    astrology: 'The Moon',
    correspondences: {
      element: 'water',
      planet: 'Moon',
      hebrew_letter: 'Gimel',
      hebrew_letter_meaning: 'camel',
      path: 13,
      esoteric_title: 'The Priestess of the Silver Star',
    },
    up: ['the veil of light', 'crossing the Abyss', 'pure intuition', 'Artemis', 'the camel'],
    meaning:
      'The Priestess sits on the path of Gimel, the only path that crosses the Abyss directly from Kether to Tiphareth, and the camel is her letter for that reason: she carries you across the desert on stored water. Crowley paints her as Artemis behind a veil of vibrating light — not secrecy but the point at which perception is too fine to become an image. The card suggests knowing that precedes evidence; one way to read it is as a caution against forcing what is still forming.',
    symbolism:
      'A crowned figure seated behind a lattice of luminous threads, bow across her lap, crystals, seeds, a camel and a lotus at her feet, the moon-crown and the drawn veil making her at once present and unreachable.',
  }),
  T({
    number: 3,
    name: 'The Empress',
    element: 'earth',
    astrology: 'Venus',
    correspondences: {
      element: 'earth',
      planet: 'Venus',
      hebrew_letter: 'Daleth',
      hebrew_letter_meaning: 'door',
      path: 14,
      esoteric_title: 'The Daughter of the Mighty Ones',
    },
    up: ['the door', 'alchemical salt', 'love under will', 'fecundity', 'the pelican'],
    meaning:
      'Daleth is a door, and the Empress is the door through which spirit enters form: Venus as the alchemical Salt, the pelican feeding its young with its own blood, the white eagle of the Great Work. Crowley reads her as love in its generative aspect — not sentiment but the active principle that makes a universe habitable. The card suggests fertility of every kind; consider what is being nourished and what it costs the one who nourishes.',
    symbolism:
      'A seated queen in rose and green with a lotus sceptre, a girdle of the zodiac, the moon at her feet and the pelican and white eagle as her heraldry, flames at the ground and a flight of birds around her throne.',
  }),
  T({
    number: 4,
    name: 'The Emperor',
    element: 'fire',
    astrology: 'Aries',
    correspondences: {
      element: 'fire',
      zodiac: 'Aries',
      hebrew_letter: 'Tzaddi',
      hebrew_letter_meaning: 'fish-hook',
      path: 15,
      esoteric_title: 'Sun of the Morning, Chief among the Mighty',
      notes:
        'Crowley exchanges the letters of The Star and The Emperor (Heh ↔ Tzaddi) following Liber AL I:57, "Tzaddi is not the Star". Zodiacal attribution stays Aries.',
    },
    up: ['sulphur', 'the ram', 'energy in command', 'authority', 'the fish-hook'],
    meaning:
      'The Emperor is Aries and alchemical Sulphur: fiery energy that has taken a shape and issues commands. Crowley gives him the letter Tzaddi, the fish-hook, on the authority of Liber AL — the trump that hooks and holds what the Star sets free. In a reading the Atu suggests governance, structure and the will to impose order; one way to read it is to ask whether the order being imposed still serves the life it was built for.',
    symbolism:
      'A bearded ruler in profile, legs crossed to form the alchemical sulphur sign, a ram’s-head sceptre and an orb with a Maltese cross, two Himalayan rams and a bee-and-fleur-de-lis shield, the lamb with the flag at his feet.',
  }),
  T({
    number: 5,
    name: 'The Hierophant',
    element: 'earth',
    astrology: 'Taurus',
    correspondences: {
      element: 'earth',
      zodiac: 'Taurus',
      hebrew_letter: 'Vau',
      hebrew_letter_meaning: 'nail',
      path: 16,
      esoteric_title: 'The Magus of the Eternal',
    },
    up: [
      'the nail',
      'initiation',
      'the priest of the New Aeon',
      'the bull',
      'teaching by transmission',
    ],
    meaning:
      'Vau is the nail, and the Hierophant is what fixes the invisible to the visible: the initiator, the transmitter of a current. Crowley makes him the priest of the Aeon of Horus, with the Child in the pentagram at his heart and the woman girt with a sword — Venus in Scorpio, the Scarlet Woman — standing before him as an equal. The card suggests instruction, tradition and the joining of inner to outer; consider whether the teaching on offer is being handed down alive or merely repeated.',
    symbolism:
      'A seated figure on a bull, the four kerubs at the corners, a wand of three interlaced rings, the pentagram window with the dancing Child, nine nails around the throne and the armed woman standing in the foreground.',
  }),
  T({
    number: 6,
    name: 'The Lovers',
    element: 'air',
    astrology: 'Gemini',
    correspondences: {
      element: 'air',
      zodiac: 'Gemini',
      hebrew_letter: 'Zain',
      hebrew_letter_meaning: 'sword',
      path: 17,
      esoteric_title: 'The Children of the Voice: the Oracle of the Mighty Gods',
    },
    up: [
      'solve',
      'the alchemical marriage',
      'analysis',
      'duality made conscious',
      'the Orphic egg',
    ],
    meaning:
      'Crowley calls The Lovers and Art the two halves of one operation: this trump is Solve, the analysis that separates in order to unite later. The Hermit officiates at a royal wedding of opposites — black king and white queen, Cain and Abel, red lion and white eagle — beneath the winged Orphic egg that holds the result. The card suggests a choice that is really a recognition of two things you are; one way to read it is as the moment where the elements of a matter become distinct enough to be joined deliberately.',
    symbolism:
      'A hooded Hermit blesses a crowned king and queen at their wedding, twin children exchange a cup and a club at their feet, Eros hovers with drawn bow, the Orphic egg coiled by a serpent presides, and the sword of Zain hangs behind.',
  }),
  T({
    number: 7,
    name: 'The Chariot',
    element: 'water',
    astrology: 'Cancer',
    correspondences: {
      element: 'water',
      zodiac: 'Cancer',
      hebrew_letter: 'Cheth',
      hebrew_letter_meaning: 'fence, enclosure',
      path: 18,
      esoteric_title: 'The Child of the Powers of the Waters: the Lord of the Triumph of Light',
    },
    up: [
      'the Grail borne',
      'enclosure',
      'the four sphinxes',
      'triumph through containment',
      'the vulture',
    ],
    meaning:
      'The Charioteer carries the Holy Grail — the cup of Babalon, spinning with blood and light — and his whole task is to bear it without spilling. Cheth is the fence: the card is about the enclosure that makes transport possible, armour that holds a sacred thing. The four sphinxes are the elements harnessed, facing outward. The card suggests progress by containment rather than by charge; consider what you are carrying and what it requires you to hold in.',
    symbolism:
      'An amber-armoured figure seated within a canopy of stars, crab crest on the helm, hands on the radiant Grail, drawn by four sphinxes of mixed elemental parts, the wheels burning, the whole vehicle shown at rest.',
  }),
  T({
    number: 8,
    name: 'Adjustment',
    element: 'air',
    astrology: 'Libra',
    correspondences: {
      element: 'air',
      zodiac: 'Libra',
      hebrew_letter: 'Lamed',
      hebrew_letter_meaning: 'ox-goad',
      path: 22,
      esoteric_title: 'The Daughter of the Lords of Truth: the Ruler of the Balance',
    },
    up: ['equilibrium', 'Maat', 'the dancer on the point', 'every act weighed', 'karma as balance'],
    meaning:
      'Crowley renamed this trump Adjustment because the process it shows is continuous, not a verdict handed down: Maat balancing the whole universe on the point of a sword, every action compensated by its equal and opposite. She is the feminine complement of the Fool — Aleph and Lamed, the ox and the goad. In a reading the Atu suggests that a matter is finding its level; one way to read it is to ask what has been added to one pan of the scale and what will be required in the other.',
    symbolism:
      'A masked feminine figure in harlequin armour poised on tiptoe, the great sword held point-down between her feet, scales hung from her crown with Alpha and Omega in the pans, the whole set within a diamond of blue and green.',
  }),
  T({
    number: 9,
    name: 'The Hermit',
    element: 'earth',
    astrology: 'Virgo',
    correspondences: {
      element: 'earth',
      zodiac: 'Virgo',
      hebrew_letter: 'Yod',
      hebrew_letter_meaning: 'hand',
      path: 20,
      esoteric_title: 'The Prophet of the Eternal, the Magus of the Voice of Power',
    },
    up: [
      'the seed',
      'the hand',
      'fertilising solitude',
      'Cerberus tamed',
      'the lamp that is the sun',
    ],
    meaning:
      'Yod is the hand and the seed-letter from which all the others are drawn, and the Thoth Hermit is above all a fertilising power in retreat: the sperm, the wheat, the Orphic egg, Cerberus made docile. His lamp does not merely light the way — it contains the sun. The card suggests withdrawal that is secretly generative; consider what is being incubated in your solitude rather than what you are avoiding by it.',
    symbolism:
      'A hooded figure bent over a lantern that holds the sun, a field of wheat, the serpent-wound egg, the three-headed hound following quietly, all in the reds of Virgo’s harvest.',
  }),
  T({
    number: 10,
    name: 'Fortune',
    element: 'fire',
    astrology: 'Jupiter',
    correspondences: {
      element: 'fire',
      planet: 'Jupiter',
      hebrew_letter: 'Kaph',
      hebrew_letter_meaning: 'palm of the hand',
      path: 21,
      esoteric_title: 'The Lord of the Forces of Life',
    },
    up: [
      'the three gunas',
      'ceaseless change',
      'Jupiter',
      'the sphinx, Hermanubis and Typhon',
      'the wheel',
    ],
    meaning:
      'Fortune is the wheel of the three gunas — sattvas the sphinx at the top, rajas Hermanubis climbing, tamas Typhon falling — and Crowley’s point is that none of them stays where it is. Jupiter here is expansion as sheer motion. The card suggests that the situation is turning under its own momentum; one way to read it is to locate which of the three you are at present and to remember that the wheel does not stop for anyone.',
    symbolism:
      'A ten-spoked wheel lit by lightning in a violet sky, the sphinx with a sword enthroned above, the ape-headed Hermanubis rising on one side and the crocodile-headed Typhon descending on the other, stars swirling behind.',
  }),
  T({
    number: 11,
    name: 'Lust',
    element: 'fire',
    astrology: 'Leo',
    correspondences: {
      element: 'fire',
      zodiac: 'Leo',
      hebrew_letter: 'Teth',
      hebrew_letter_meaning: 'serpent',
      path: 19,
      esoteric_title: 'The Daughter of the Flaming Sword',
    },
    up: [
      'the rapture of vigour',
      'Babalon and the Beast',
      'ecstatic power',
      'the Grail lifted',
      'joy in force',
    ],
    meaning:
      'Crowley named this trump Lust to say what the older title only implied: not restraint of the animal but rapture in it. Babalon rides the seven-headed Beast, drunk, holding the Grail aloft, and the picture is of energy enjoyed rather than controlled. The card suggests power that arrives as appetite and courage together; one way to read it is to ask where you are being invited to ride the force rather than hold its jaws shut.',
    symbolism:
      'A naked woman astride a lion-bodied beast with seven heads — angel, saint, poet, adulteress, warrior, satyr, lion-serpent — raising a flaming cup, the ten rays of the sun behind her and the figures of the saints dissolved into light at the top of the card.',
  }),
  T({
    number: 12,
    name: 'The Hanged Man',
    element: 'water',
    astrology: 'Water',
    correspondences: {
      element: 'water',
      hebrew_letter: 'Mem',
      hebrew_letter_meaning: 'water',
      path: 23,
      esoteric_title: 'The Spirit of the Mighty Waters',
    },
    up: [
      'the drowned man',
      'redemption by water',
      'the ankh',
      'suspension',
      'a formula of the old Aeon',
    ],
    meaning:
      'The Thoth Hanged Man hangs from an ankh by one foot, arms and head forming a triangle, the serpent of new life at the base: Mem, the waters, the sacrifice that redeems by dissolution. Crowley is blunt that this formula — the dying god — belongs to the Aeon that has passed, and the card in a reading is therefore often a warning as much as a promise. It suggests a suspension of will; consider whether you are surrendering to something living or repeating a sacrifice the moment no longer asks for.',
    symbolism:
      'A pale figure suspended upside down from an ankh, nailed at hands and foot, over a grid of green water and the coiled serpent, the whole drowned in blue with rays of light around the head.',
  }),
  T({
    number: 13,
    name: 'Death',
    element: 'water',
    astrology: 'Scorpio',
    correspondences: {
      element: 'water',
      zodiac: 'Scorpio',
      hebrew_letter: 'Nun',
      hebrew_letter_meaning: 'fish',
      path: 24,
      esoteric_title: 'The Child of the Great Transformers: the Lord of the Gate of Death',
    },
    up: [
      'putrefaction',
      'the dancing skeleton',
      'scorpion, serpent, eagle',
      'transformation',
      'the fish',
    ],
    meaning:
      'The Thoth Death is an alchemical operation — putrefaction, the necessary rotting from which new form is drawn — shown as a skeleton dancing with a scythe whose sweep stirs bubbles of new life. Scorpio gives the card its three stages: the scorpion that stings itself, the serpent that renews, the eagle that rises. It suggests a transformation already under way rather than a loss to be prevented; one way to read it is to ask which of the three stages you are in.',
    symbolism:
      'A crowned black skeleton in a dance of Shiva, the scythe carving through the dark, bubbles containing the seeds of new bodies, a fish, a scorpion at the base, a lily, the serpent and the eagle rising in the corner.',
  }),
  T({
    number: 14,
    name: 'Art',
    element: 'fire',
    astrology: 'Sagittarius',
    correspondences: {
      element: 'fire',
      zodiac: 'Sagittarius',
      hebrew_letter: 'Samekh',
      hebrew_letter_meaning: 'prop, tent-peg',
      path: 25,
      esoteric_title: 'The Daughter of the Reconcilers: the Bringer-forth of Life',
    },
    up: ['coagula', 'the consummated marriage', 'fire and water mixed', 'VITRIOL', 'the rainbow'],
    meaning:
      'Art is the second half of the operation begun in The Lovers: Coagula, the union completed. The king and queen have become one two-faced figure pouring fire and water into a single cauldron, and around it runs the alchemical motto whose initials spell VITRIOL — visit the interior of the earth and, by rectifying, you will find the hidden stone. The card suggests a synthesis achieved by patient mixing of what seemed incompatible; consider what in your situation is ready to be combined rather than chosen between.',
    symbolism:
      'An androgyne with two heads, one crowned white and one black, mixing fire and water into a golden cauldron over which a raven perches on a skull, a lion and an eagle exchanged in colour at the feet, the rainbow arched behind and the Latin motto ringing the whole.',
  }),
  T({
    number: 15,
    name: 'The Devil',
    element: 'earth',
    astrology: 'Capricorn',
    correspondences: {
      element: 'earth',
      zodiac: 'Capricorn',
      hebrew_letter: 'Ayin',
      hebrew_letter_meaning: 'eye',
      path: 26,
      esoteric_title: 'The Lord of the Gates of Matter: the Child of the Forces of Time',
    },
    up: [
      'Pan Pangenetor',
      'creative energy in matter',
      'the goat of Mendes',
      'the third eye',
      'unashamed nature',
    ],
    meaning:
      'Crowley strips this trump of moral dread: it is Pan, the all-begetter, creative energy at its most material and least apologetic, the goat leaping on the mountaintop with the third eye open. The chained figures of older decks are replaced by cells of new life in the roots of the world-tree. The card suggests drive, appetite and the humour of nature; one way to read it is to ask what wants to be made and what shame is standing in its way.',
    symbolism:
      'A Himalayan goat with spiral horns and a third eye stands before the trunk of a tree that pierces the heavens, two globes at its base filled with dancing figures, the caduceus wand in the foreground and rings of the planet Saturn behind.',
  }),
  T({
    number: 16,
    name: 'The Tower',
    element: 'fire',
    astrology: 'Mars',
    correspondences: {
      element: 'fire',
      planet: 'Mars',
      hebrew_letter: 'Peh',
      hebrew_letter_meaning: 'mouth',
      path: 27,
      esoteric_title: 'The Lord of the Hosts of the Mighty',
    },
    up: [
      'the eye of Shiva',
      'the mouth that utters destruction',
      'war',
      'the old order broken',
      'the dove and the serpent',
    ],
    meaning:
      'The Thoth Tower is destruction as purification: the Eye of Shiva opens at the top of the card and the whole structure below is annihilated by its glance, the mouth of Dis breathing flame at the base. Crowley pairs the dove and the lion-serpent in the corners — the two ways of love, gentleness and force, that survive the collapse. The card suggests the sudden end of an arrangement that had outlived its truth; consider what is being burned away and what remains when it is.',
    symbolism:
      'A tower split by flame and the jaws of a beast, geometric figures falling from it, the open Eye above emitting rays, the dove with an olive branch and the lion-serpent Abraxas in the upper corners.',
  }),
  T({
    number: 17,
    name: 'The Star',
    element: 'air',
    astrology: 'Aquarius',
    correspondences: {
      element: 'air',
      zodiac: 'Aquarius',
      hebrew_letter: 'Heh',
      hebrew_letter_meaning: 'window',
      path: 28,
      esoteric_title: 'The Daughter of the Firmament: the Dweller between the Waters',
      notes: 'Letter Heh by Crowley’s exchange with The Emperor (Liber AL I:57).',
    },
    up: [
      'Nuit pouring',
      'every man and every woman is a star',
      'the seven-pointed star',
      'renewal',
      'the spiral',
    ],
    meaning:
      'The Star is Nuit herself, the goddess of infinite space, pouring the waters of consciousness from two cups — one onto her own head, one onto the earth — in an unbroken spiral. The seven-pointed star of Venus and Babalon turns behind her. Crowley gives this trump the letter Heh, the window, on the authority of Liber AL. The card suggests renewal by receiving rather than by doing; one way to read it is as a reminder that your own nature is the source you are looking for.',
    symbolism:
      'A naked woman kneeling on the curve of the earth, one cup raised above her head and one poured out below, the great seven-pointed star and a smaller one behind, spirals of light, roses and butterflies across the ground.',
  }),
  T({
    number: 18,
    name: 'The Moon',
    element: 'water',
    astrology: 'Pisces',
    correspondences: {
      element: 'water',
      zodiac: 'Pisces',
      hebrew_letter: 'Qoph',
      hebrew_letter_meaning: 'back of the head',
      path: 29,
      esoteric_title: 'The Ruler of Flux and Reflux: the Child of the Sons of the Mighty',
    },
    up: [
      'the darkest hour',
      'Khephra bearing the sun',
      'the gateway of resurrection',
      'illusion',
      'the two Anubis',
    ],
    meaning:
      'The Thoth Moon is the midnight of the soul: the path of Qoph, the back of the head where consciousness is at its dimmest, guarded by two figures of Anubis and their jackals, while the beetle Khephra carries the sun unseen beneath the waters toward dawn. Crowley calls it the gateway of resurrection, and the threshold is deliberately frightening. The card suggests a passage through illusion and dread that must be walked rather than solved; consider what you cannot see clearly right now and whether you need to.',
    symbolism:
      'A waning moon over a path between two towers, two jackal-headed guardians with staves, their beasts at their feet, and below the surface of the dark water the scarab Khephra pushing the solar disk.',
  }),
  T({
    number: 19,
    name: 'The Sun',
    element: 'fire',
    astrology: 'The Sun',
    correspondences: {
      element: 'fire',
      planet: 'Sun',
      hebrew_letter: 'Resh',
      hebrew_letter_meaning: 'head',
      path: 30,
      esoteric_title: 'The Lord of the Fire of the World',
    },
    up: [
      'the twins dancing',
      'the Rose-cross',
      'freedom of the New Aeon',
      'the wall left behind',
      'illumination',
    ],
    meaning:
      'Crowley’s Sun has twelve rays for the signs and a Rose-cross at its heart, and the wall that in older decks enclosed a garden now stands low on a green mound with two winged children dancing freely beyond it: the restraint of the old Aeon lifted. The card suggests illumination that is also liberty — seeing clearly and no longer being fenced. One way to read it is to ask what wall you are still treating as a boundary after it has stopped holding anything in.',
    symbolism:
      'A radiant sun with twelve rays and a rose at its centre, the zodiac in a ring around, two winged children dancing on a green hill before a low wall, butterflies and the signs in the border.',
  }),
  T({
    number: 20,
    name: 'The Aeon',
    element: 'fire',
    astrology: 'Fire and Spirit',
    correspondences: {
      element: 'spirit',
      hebrew_letter: 'Shin',
      hebrew_letter_meaning: 'tooth',
      path: 31,
      esoteric_title: 'The Spirit of the Primal Fire',
    },
    up: [
      'the Crowned and Conquering Child',
      'Nuit, Hadit, Ra-Hoor-Khuit',
      'the new aeon',
      'Shin',
      'a new order of time',
    ],
    meaning:
      'Where older decks show a last judgement, the Thoth trump shows the beginning of an aeon: Nuit arched across the sky, Hadit as the winged globe at her centre, and the Child Horus — Ra-Hoor-Khuit enthroned and Hoor-paar-kraat silent within him — standing in the letter Shin. Crowley’s Aeon is not a reckoning of the past but a change in the rules of time. The card suggests a fundamental shift in how a matter is to be understood; one way to read it is that the old framework will not explain what happens next.',
    symbolism:
      'The star-bodied goddess Nuit arched over the scene, the winged disk Hadit at her centre, the Child in gold seated within a translucent figure of himself, the flaming letter Shin with three yods below and the Hebrew letters of the aeon along the ground.',
  }),
  T({
    number: 21,
    name: 'The Universe',
    element: 'earth',
    astrology: 'Saturn and Earth',
    correspondences: {
      element: 'earth',
      planet: 'Saturn',
      hebrew_letter: 'Tau',
      hebrew_letter_meaning: 'cross, mark',
      path: 32,
      esoteric_title: 'The Great One of the Night of Time',
    },
    up: [
      'completion',
      'the dancer and the serpent',
      'the Eye',
      'the ninety-two elements',
      'the end of a matter',
    ],
    meaning:
      'The Universe is Tau, the last letter, Saturn and Earth together: a maiden dances with the great serpent inside a wreath of seventy-two sections, the four kerubs in the corners and the Eye of Horus opening above, while the skeleton of the periodic table lies at the base — the whole of matter rendered as a completed pattern. Crowley calls it the end of a matter and the beginning of the next round. The card suggests a cycle fully worked out; consider what has reached its final form and what the dancer is about to do with it.',
    symbolism:
      'A dancing figure entwined with a serpent within an oval of stars and mathematical figures, the four kerubic heads at the corners, the great Eye above, a building of the elements below and the wheel of the zodiac set into the frame.',
  }),
];
