import type { CardSeed } from '@/domain/decks/types';
import { court, pip } from './_builders';

/** RWS Swords (air) and Pentacles (earth). Sort blocks: swords 50–63, pentacles 64–77. */

const S = { suit: 'swords', suitLabel: 'Swords', base: 50 } as const;
const P = { suit: 'pentacles', suitLabel: 'Pentacles', base: 64 } as const;

export const RWS_SWORDS: CardSeed[] = [
  pip({
    ...S,
    number: 1,
    astrology: 'Root of air',
    correspondences: { notes: 'Root of the powers of air' },
    up: ['clarity', 'breakthrough', 'truth', 'a decisive thought', 'mental force'],
    rev: ['confusion', 'a truth misused', 'clouded judgement', 'a decision that cuts wrong'],
    meaning:
      'The Ace of Swords suggests a clear thought cutting through. It tends to point to a breakthrough in understanding, a truth named plainly, or a decision that becomes obvious once said. Consider what has just become clear to you, and what it costs to act on it.',
    reversed:
      'Reversed, the Ace may suggest a mind clouded or a truth wielded carelessly — clarity without kindness.',
    symbolism:
      'A hand from a cloud holds an upright sword whose tip passes through a crown hung with a palm and an olive branch, above jagged grey mountains.',
  }),
  pip({
    ...S,
    number: 2,
    astrology: 'Moon in Libra',
    correspondences: {
      decan: 'Moon in Libra · 1st decan (0°–10°)',
      planet: 'Moon',
      zodiac: 'Libra',
    },
    up: ['stalemate', 'a difficult choice', 'blocked feeling', 'truce', 'avoidance'],
    rev: ['indecision ending', 'information revealed', 'a truce breaking', 'overload'],
    meaning:
      'The Two of Swords points to a decision held at arm’s length. It often suggests a balance kept by not looking — two positions defended equally, feeling shut out so that neither can win. One way to read it: the blindfold is yours to remove, and the sea behind you is the part you are not looking at.',
    reversed:
      'Reversed, the card may suggest the stalemate breaking, sometimes because information arrives that makes the choice unavoidable.',
    symbolism:
      'A blindfolded woman in white sits before the sea holding two crossed swords over her chest; a crescent moon hangs above rocky water.',
  }),
  pip({
    ...S,
    number: 3,
    astrology: 'Saturn in Libra',
    correspondences: {
      decan: 'Saturn in Libra · 2nd decan (10°–20°)',
      planet: 'Saturn',
      zodiac: 'Libra',
    },
    up: ['heartbreak', 'painful truth', 'grief', 'separation', 'sorrow named'],
    rev: ['recovery', 'forgiveness', 'releasing pain', 'a hurt still unspoken'],
    meaning:
      'The Three of Swords suggests a hurt that has been named exactly. It tends to point to heartbreak, betrayal or a painful truth, and to the strange clarity that comes with it. Consider what has pierced you here, and whether the pain is fresh or an old wound touched again.',
    reversed:
      'Reversed, the card may suggest the beginning of recovery, or a sorrow that still has not been said aloud.',
    symbolism:
      'Three swords pierce a red heart floating against grey clouds and falling rain. There is no figure; the image states the wound and nothing else.',
  }),
  pip({
    ...S,
    number: 4,
    astrology: 'Jupiter in Libra',
    correspondences: {
      decan: 'Jupiter in Libra · 3rd decan (20°–30°)',
      planet: 'Jupiter',
      zodiac: 'Libra',
    },
    up: ['rest', 'recovery', 'retreat', 'stillness', 'recuperation'],
    rev: ['restlessness', 'burnout', 'returning to activity', 'stagnation'],
    meaning:
      'The Four of Swords points to rest as a necessary act, not a failure to act. It often suggests withdrawal to recover, a truce with your own thoughts, and time set aside before the next effort. One way to read it: nothing needs to be solved today.',
    reversed:
      'Reversed, the card may suggest rest refused until it is forced, or a period of recovery coming to its natural end.',
    symbolism:
      'A knight lies in effigy on a tomb, hands in prayer, one sword beneath him and three hung on the wall above; a stained-glass window shows a healing scene.',
  }),
  pip({
    ...S,
    number: 5,
    astrology: 'Venus in Aquarius',
    correspondences: {
      decan: 'Venus in Aquarius · 1st decan (0°–10°)',
      planet: 'Venus',
      zodiac: 'Aquarius',
    },
    up: ['conflict', 'a hollow victory', 'defeat', 'winning at a cost', 'dishonour'],
    rev: ['reconciliation', 'letting go of a grudge', 'regret', 'an old conflict revisited'],
    meaning:
      'The Five of Swords suggests a win that leaves everyone poorer. It tends to point to conflict where being right mattered more than being kind, and to the loneliness on either side of it. Ask whose position you occupy in the picture — the one collecting swords or the ones walking away.',
    reversed:
      'Reversed, it may suggest a wish to repair what a conflict broke, or the recognition that a battle was not worth winning.',
    symbolism:
      'A smirking man gathers three swords while two others lie at his feet; two figures walk away toward a choppy sea under ragged clouds.',
  }),
  pip({
    ...S,
    number: 6,
    astrology: 'Mercury in Aquarius',
    correspondences: {
      decan: 'Mercury in Aquarius · 2nd decan (10°–20°)',
      planet: 'Mercury',
      zodiac: 'Aquarius',
    },
    up: ['transition', 'moving on', 'passage', 'leaving trouble behind', 'gradual relief'],
    rev: ['unable to move on', 'baggage', 'a rough crossing', 'returning to the past'],
    meaning:
      'The Six of Swords points to a crossing from rough water to calmer. It often suggests a transition undertaken quietly, carrying what you must, toward a shore that is not yet visible but is there. One way to read it: the relief is gradual, and the direction is right.',
    reversed:
      'Reversed, the card may suggest a passage delayed or a difficulty you keep bringing along with you.',
    symbolism:
      'A ferryman poles a boat carrying a hooded woman and a child across a river, six swords standing in the bow; the water ahead is smooth, behind it choppy.',
  }),
  pip({
    ...S,
    number: 7,
    astrology: 'Moon in Aquarius',
    correspondences: {
      decan: 'Moon in Aquarius · 3rd decan (20°–30°)',
      planet: 'Moon',
      zodiac: 'Aquarius',
    },
    up: ['strategy', 'stealth', 'getting away with something', 'partial success', 'deception'],
    rev: ['coming clean', 'a plan exposed', 'self-deception', 'conscience'],
    meaning:
      'The Seven of Swords suggests cleverness that avoids a direct confrontation. It tends to point to strategy, secrecy, or a plan that works by not being seen — and to the two swords left behind. Consider whether the indirect route is wise here, or simply easier.',
    reversed:
      'Reversed, the card may suggest a hidden plan brought into the open, or the pull of conscience toward honesty.',
    symbolism:
      'A man tiptoes away from a camp carrying five swords, looking back over his shoulder; two swords remain planted in the ground.',
  }),
  pip({
    ...S,
    number: 8,
    astrology: 'Jupiter in Gemini',
    correspondences: {
      decan: 'Jupiter in Gemini · 1st decan (0°–10°)',
      planet: 'Jupiter',
      zodiac: 'Gemini',
    },
    up: [
      'feeling trapped',
      'restriction',
      'self-imposed limits',
      'powerlessness',
      'a way out unseen',
    ],
    rev: ['release', 'new perspective', 'taking back control', 'facing fear'],
    meaning:
      'The Eight of Swords points to a bind that is tighter in the mind than on the ground. It often suggests feeling trapped by circumstances, thoughts or other people’s expectations, while the bonds are loose and the feet are free. Ask what you would do if you were sure you could move.',
    reversed:
      'Reversed, the card may suggest the blindfold slipping — a limit recognised as self-imposed and therefore negotiable.',
    symbolism:
      'A bound and blindfolded woman stands among eight swords planted in wet ground, a castle on the cliff behind her. Her feet are unbound.',
  }),
  pip({
    ...S,
    number: 9,
    astrology: 'Mars in Gemini',
    correspondences: {
      decan: 'Mars in Gemini · 2nd decan (10°–20°)',
      planet: 'Mars',
      zodiac: 'Gemini',
    },
    up: ['anxiety', 'sleeplessness', 'dread', 'guilt', 'worry in the dark'],
    rev: ['releasing fear', 'seeking help', 'the worst not happening', 'despair'],
    meaning:
      'The Nine of Swords suggests the mind at three in the morning. It tends to point to worry, guilt or dread that grows in the dark and shrinks in daylight — real distress about things that may or may not be real. Consider what you are afraid of, and who you could say it to.',
    reversed:
      'Reversed, the card may suggest a fear easing once spoken, or, at its heaviest, despair that needs support rather than solitude.',
    symbolism:
      'A figure sits up in bed with face in hands, nine swords hanging on the dark wall; the quilt is patterned with roses and zodiac signs.',
  }),
  pip({
    ...S,
    number: 10,
    astrology: 'Sun in Gemini',
    correspondences: {
      decan: 'Sun in Gemini · 3rd decan (20°–30°)',
      planet: 'Sun',
      zodiac: 'Gemini',
    },
    up: ['an ending', 'rock bottom', 'finality', 'exhaustion', 'the dawn after'],
    rev: ['recovery', 'resisting the end', 'survival', 'things improving'],
    meaning:
      'The Ten of Swords points to something definitively over. It often suggests a painful ending, a defeat that cannot be argued with, and — in the yellow sky at the horizon — the fact that nothing further can be taken. One way to read it: the worst is behind you, even if it does not feel that way yet.',
    reversed:
      'Reversed, the card may suggest slow recovery from a low point, or an ending that is being resisted rather than accepted.',
    symbolism:
      'A figure lies face down with ten swords in the back beneath a black sky, while the horizon beyond the still water begins to turn gold.',
  }),
  court({
    ...S,
    rank: 'Page',
    rankIndex: 0,
    astrology: 'Earth of air',
    correspondences: { sub_element: 'earth' },
    up: ['curiosity', 'vigilance', 'new ideas', 'a message', 'watchfulness'],
    rev: ['gossip', 'defensiveness', 'scattered thinking', 'all talk'],
    meaning:
      'The Page of Swords suggests a mind on alert. It often points to curiosity, quick questions, a piece of news or an idea that needs testing, and a certain readiness to argue. Consider what you are trying to find out, and whether you are listening as sharply as you are watching.',
    reversed:
      'Reversed, the Page may suggest talk without substance, or watchfulness turned into suspicion.',
    symbolism:
      'A youth stands on high ground with a sword raised in both hands, hair blown by wind, looking back over one shoulder at something out of frame.',
  }),
  court({
    ...S,
    rank: 'Knight',
    rankIndex: 1,
    astrology: 'Air of air',
    correspondences: { sub_element: 'air' },
    up: ['directness', 'speed', 'conviction', 'a charge', 'decisive action'],
    rev: ['recklessness', 'aggression', 'a rush without thought', 'arrogance'],
    meaning:
      'The Knight of Swords points to conviction moving at full speed. He tends to suggest directness, urgency, and the willingness to cut through delay — sometimes before checking what is in the way. Ask whether the matter needs this much force, and whether you have looked ahead.',
    reversed:
      'Reversed, the Knight may suggest speed that has become recklessness, or argument for its own sake.',
    symbolism:
      'An armoured knight charges on a grey horse with sword raised, cloak flying, against a sky of storm-torn clouds and bent trees.',
  }),
  court({
    ...S,
    rank: 'Queen',
    rankIndex: 2,
    astrology: 'Water of air',
    correspondences: { sub_element: 'water' },
    up: ['clear perception', 'independence', 'honesty', 'experience', 'boundaries'],
    rev: ['bitterness', 'coldness', 'cruelty', 'isolation behind intellect'],
    meaning:
      'The Queen of Swords suggests clarity earned through loss. She often points to honesty without cruelty, boundaries held without apology, and the ability to see a situation for what it is. One way to read her: the kindest thing available right now may be the truth.',
    reversed:
      'Reversed, the Queen may suggest sharpness that has hardened into bitterness, or a mind used to keep others at a distance.',
    symbolism:
      'A queen sits in profile on a throne carved with a cherub and butterflies, sword upright, one hand extended open; clouds gather low and a single bird flies above.',
  }),
  court({
    ...S,
    rank: 'King',
    rankIndex: 3,
    astrology: 'Fire of air',
    correspondences: { sub_element: 'fire' },
    up: ['intellectual authority', 'judgement', 'fairness', 'analysis', 'clear command'],
    rev: ['tyranny of logic', 'manipulation', 'coldness', 'abuse of authority'],
    meaning:
      'The King of Swords points to reason in command. He tends to suggest judgement, expertise, and decisions made on principle rather than sentiment — a fair arbiter, or a demand to think this through properly. Consider where impartial thinking would serve you, and where it might be a way of not feeling.',
    reversed:
      'Reversed, the King may suggest intellect used to control, or a verdict handed down without hearing the case.',
    symbolism:
      'A king faces forward on a throne carved with butterflies and crescents, sword tilted slightly, two birds in the sky and low clouds behind.',
  }),
];

export const RWS_PENTACLES: CardSeed[] = [
  pip({
    ...P,
    number: 1,
    astrology: 'Root of earth',
    correspondences: { notes: 'Root of the powers of earth' },
    up: ['opportunity', 'a material beginning', 'prosperity', 'groundedness', 'a seed'],
    rev: ['a missed opportunity', 'poor planning', 'greed', 'instability'],
    meaning:
      'The Ace of Pentacles suggests something tangible being offered. It tends to point to an opportunity with real substance — money, work, a home, health — and to the patience that turning a seed into a harvest requires. Consider what practical opening is in front of you.',
    reversed:
      'Reversed, the Ace may suggest an opportunity let slip, or a foundation laid too hastily to hold.',
    symbolism:
      'A hand from a cloud holds a large golden coin above a garden of lilies; a hedge arch opens onto a path toward distant mountains.',
  }),
  pip({
    ...P,
    number: 2,
    astrology: 'Jupiter in Capricorn',
    correspondences: {
      decan: 'Jupiter in Capricorn · 1st decan (0°–10°)',
      planet: 'Jupiter',
      zodiac: 'Capricorn',
    },
    up: ['balance', 'juggling', 'adaptability', 'priorities', 'flow under pressure'],
    rev: ['overwhelm', 'dropped commitments', 'disorganisation', 'financial strain'],
    meaning:
      'The Two of Pentacles points to keeping several things in the air. It often suggests adaptability, changing priorities, and the light-footedness that busyness demands — with rougher seas behind. Ask which of the things you are juggling could be set down.',
    reversed:
      'Reversed, the card may suggest the juggling failing — too many commitments, and something about to drop.',
    symbolism:
      'A young man dances on one foot juggling two coins bound by a lemniscate-shaped ribbon while ships ride enormous waves behind him.',
  }),
  pip({
    ...P,
    number: 3,
    astrology: 'Mars in Capricorn',
    correspondences: {
      decan: 'Mars in Capricorn · 2nd decan (10°–20°)',
      planet: 'Mars',
      zodiac: 'Capricorn',
    },
    up: ['craft', 'collaboration', 'skill recognised', 'building', 'learning by doing'],
    rev: ['poor teamwork', 'mediocre work', 'lack of recognition', 'ego in a group'],
    meaning:
      'The Three of Pentacles suggests skilled work done with others. It tends to point to craft, apprenticeship and collaboration — expertise brought together on something bigger than one person could build. Consider whose skills this situation needs, and how yours fit.',
    reversed:
      'Reversed, the card may suggest work suffering from poor coordination, or effort that goes unacknowledged.',
    symbolism:
      'A sculptor on a bench works on a church arch while a monk and a hooded figure consult a plan; three pentacles are carved into the stonework above.',
  }),
  pip({
    ...P,
    number: 4,
    astrology: 'Sun in Capricorn',
    correspondences: {
      decan: 'Sun in Capricorn · 3rd decan (20°–30°)',
      planet: 'Sun',
      zodiac: 'Capricorn',
    },
    up: ['security', 'holding on', 'control', 'saving', 'possessiveness'],
    rev: ['letting go', 'generosity', 'financial loss', 'insecurity'],
    meaning:
      'The Four of Pentacles points to security kept by gripping. It often suggests saving, stability, and a control over resources that begins to cost movement — a coin on the head, one clutched, two underfoot. One way to read it: what are you protecting, and what does holding it this tightly prevent?',
    reversed:
      'Reversed, the card may suggest the grip loosening, by choice or by loss, and the space that opens either way.',
    symbolism:
      'A crowned man sits on a stone bench clutching a pentacle to his chest, one balanced on his crown and one under each foot, a city behind him.',
  }),
  pip({
    ...P,
    number: 5,
    astrology: 'Mercury in Taurus',
    correspondences: {
      decan: 'Mercury in Taurus · 1st decan (0°–10°)',
      planet: 'Mercury',
      zodiac: 'Taurus',
    },
    up: ['hardship', 'exclusion', 'material loss', 'feeling left out in the cold', 'help unseen'],
    rev: ['recovery', 'help accepted', 'the end of a hard period', 'spiritual poverty'],
    meaning:
      'The Five of Pentacles suggests a hard stretch, and the sense of being outside while others are warm. It tends to point to material or bodily difficulty, to shame, and to help that is nearer than it looks — the lit window is right there. Ask what support you have not been able to ask for.',
    reversed:
      'Reversed, the card may suggest hardship easing, or the door finally being knocked on.',
    symbolism:
      'Two ragged figures, one on crutches, pass through snow beneath a lit stained-glass window showing five pentacles in a tree.',
  }),
  pip({
    ...P,
    number: 6,
    astrology: 'Moon in Taurus',
    correspondences: {
      decan: 'Moon in Taurus · 2nd decan (10°–20°)',
      planet: 'Moon',
      zodiac: 'Taurus',
    },
    up: ['generosity', 'giving and receiving', 'charity', 'fairness in exchange', 'support'],
    rev: ['strings attached', 'debt', 'inequality', 'one-sided giving'],
    meaning:
      'The Six of Pentacles points to resources moving between people. It often suggests generosity, help given or received, and the balance of power that any exchange carries. One way to read it: notice which figure in the picture you are, and whether the scales are fair.',
    reversed:
      'Reversed, the card may suggest a gift that is really a transaction, or a dependence that has become uncomfortable.',
    symbolism:
      'A merchant holding scales in one hand drops coins into the palm of a kneeling beggar while a second kneels beside; a town rises behind.',
  }),
  pip({
    ...P,
    number: 7,
    astrology: 'Saturn in Taurus',
    correspondences: {
      decan: 'Saturn in Taurus · 3rd decan (20°–30°)',
      planet: 'Saturn',
      zodiac: 'Taurus',
    },
    up: ['patience', 'assessment', 'long-term effort', 'waiting for growth', 'taking stock'],
    rev: ['impatience', 'poor investment', 'effort without return', 'giving up too soon'],
    meaning:
      'The Seven of Pentacles suggests pausing to look at what has grown. It tends to point to patience, slow returns and the honest question of whether the effort is paying off — or whether to keep tending a while longer. Consider what you have invested here and what you expect back.',
    reversed:
      'Reversed, the card may suggest frustration with slow growth, or a project that deserves reassessment rather than more effort.',
    symbolism:
      'A young farmer leans on a hoe gazing at a vine heavy with six pentacles, a seventh at his feet, in a plain field.',
  }),
  pip({
    ...P,
    number: 8,
    astrology: 'Sun in Virgo',
    correspondences: { decan: 'Sun in Virgo · 1st decan (0°–10°)', planet: 'Sun', zodiac: 'Virgo' },
    up: ['diligence', 'skill building', 'repetition', 'craftsmanship', 'focus'],
    rev: ['perfectionism', 'tedium', 'cutting corners', 'work without meaning'],
    meaning:
      'The Eight of Pentacles points to getting better by doing the thing again. It often suggests apprenticeship, focus, and the quiet dignity of work done well for its own sake. One way to read it: mastery here is a matter of the next repetition, not a leap.',
    reversed:
      'Reversed, the card may suggest repetition without growth, or a standard so exacting that nothing gets finished.',
    symbolism:
      'A craftsman sits on a bench chiselling a pentacle, six finished ones displayed on a post beside him and one at his feet; a town lies in the distance.',
  }),
  pip({
    ...P,
    number: 9,
    astrology: 'Venus in Virgo',
    correspondences: {
      decan: 'Venus in Virgo · 2nd decan (10°–20°)',
      planet: 'Venus',
      zodiac: 'Virgo',
    },
    up: ['self-sufficiency', 'refinement', 'earned comfort', 'independence', 'enjoying the garden'],
    rev: ['over-reliance on others', 'hollow success', 'financial setback', 'isolation in comfort'],
    meaning:
      'The Nine of Pentacles suggests comfort you built yourself. It tends to point to independence, discipline that has matured into ease, and the pleasure of a garden that took years. Consider what you have earned the right to enjoy, and whether you are letting yourself.',
    reversed:
      'Reversed, the card may suggest security that depends on someone else, or abundance that feels empty because it is unshared.',
    symbolism:
      'A woman in an embroidered gown stands in a vineyard heavy with grapes, a hooded falcon on her gloved hand and nine pentacles around her.',
  }),
  pip({
    ...P,
    number: 10,
    astrology: 'Mercury in Virgo',
    correspondences: {
      decan: 'Mercury in Virgo · 3rd decan (20°–30°)',
      planet: 'Mercury',
      zodiac: 'Virgo',
    },
    up: ['legacy', 'family wealth', 'long-term security', 'inheritance', 'roots'],
    rev: ['family disputes', 'financial failure', 'a legacy in question', 'stability lost'],
    meaning:
      'The Ten of Pentacles points to what lasts beyond one lifetime. It often suggests family, inheritance, tradition and the kind of security that comes from generations — along with the obligations attached. One way to read it: what are you building that will outlast you, and for whom?',
    reversed:
      'Reversed, the card may suggest a legacy contested, or a foundation that looked solid and is not.',
    symbolism:
      'An old man in a patterned robe sits with two dogs beneath an archway while a couple and child stand beyond; ten pentacles are arranged over the scene in the pattern of the Tree of Life.',
  }),
  court({
    ...P,
    rank: 'Page',
    rankIndex: 0,
    astrology: 'Earth of earth',
    correspondences: { sub_element: 'earth' },
    up: ['study', 'a practical beginning', 'diligence', 'a new skill', 'an opportunity to learn'],
    rev: ['procrastination', 'lack of progress', 'daydreaming about results', 'poor focus'],
    meaning:
      'The Page of Pentacles suggests a beginning taken seriously. It often points to study, a new skill, a practical opportunity, and the steady attention that turns interest into competence. Consider what you are ready to learn properly, and what the first lesson is.',
    reversed:
      'Reversed, the Page may suggest an intention that never becomes practice, or plans that stay in the head.',
    symbolism:
      'A youth stands in a flowering field holding a pentacle up in both hands, studying it, with a ploughed field and mountains behind.',
  }),
  court({
    ...P,
    rank: 'Knight',
    rankIndex: 1,
    astrology: 'Air of earth',
    correspondences: { sub_element: 'air' },
    up: ['reliability', 'methodical effort', 'routine', 'patience', 'hard work'],
    rev: ['stagnation', 'boredom', 'stubbornness', 'perfectionism'],
    meaning:
      'The Knight of Pentacles points to steady, unglamorous progress. He tends to suggest reliability, routine, and the willingness to do the necessary thing again tomorrow — the slowest knight, and the one who arrives. Ask where persistence rather than brilliance is what the situation needs.',
    reversed:
      'Reversed, the Knight may suggest routine that has become a rut, or thoroughness that will not let anything move.',
    symbolism:
      'A knight sits motionless on a heavy black horse in a ploughed field, holding a pentacle and looking at it rather than ahead.',
  }),
  court({
    ...P,
    rank: 'Queen',
    rankIndex: 2,
    astrology: 'Water of earth',
    correspondences: { sub_element: 'water' },
    up: ['nurture', 'practicality', 'security offered', 'warmth', 'resourcefulness'],
    rev: ['self-neglect', 'smothering', 'work–home imbalance', 'materialism'],
    meaning:
      'The Queen of Pentacles suggests care made practical. She often points to warmth expressed through food, shelter and attention to detail — someone who makes a place feel safe, and who may forget her own needs in doing so. One way to read her: the situation asks for grounded, tangible care.',
    reversed:
      'Reversed, the Queen may suggest care given until nothing is left, or comfort valued over connection.',
    symbolism:
      'A queen sits in a garden bower of roses on a throne carved with goats and fruit, holding a pentacle in her lap, a rabbit at the corner of the frame.',
  }),
  court({
    ...P,
    rank: 'King',
    rankIndex: 3,
    astrology: 'Fire of earth',
    correspondences: { sub_element: 'fire' },
    up: ['prosperity', 'stewardship', 'reliability', 'mastery of the material', 'generosity'],
    rev: ['greed', 'rigidity', 'status over substance', 'possessiveness'],
    meaning:
      'The King of Pentacles points to abundance managed well. He tends to suggest stewardship, patience rewarded, and the calm of someone who knows what things cost and what they are worth. Consider what you are responsible for keeping stable, and whether you are enjoying it.',
    reversed:
      'Reversed, the King may suggest wealth held too tightly, or success that has become a way of keeping score.',
    symbolism:
      'A king sits on a throne carved with bulls among vines and grapes, a pentacle under one hand and a sceptre in the other, his castle behind him.',
  }),
];
