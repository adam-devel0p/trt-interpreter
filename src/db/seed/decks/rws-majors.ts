import type { CardSeed } from '@/domain/decks/types';
import { major } from './_builders';

/**
 * Rider–Waite–Smith Major Arcana. Names, numbering (Strength VIII, Justice XI) and imagery
 * follow the 1909 deck; astrological notes follow the Golden Dawn scheme Waite worked from.
 * Meanings are written as reflection prompts, never predictions (DESIGN_SYSTEM copy rules).
 */
export const RWS_MAJORS: CardSeed[] = [
  major({
    number: 0,
    name: 'The Fool',
    element: 'air',
    astrology: 'Air (Uranus in modern practice)',
    correspondences: { element: 'air', planet: 'Uranus' },
    up: ['beginnings', 'openness', 'a leap', 'innocence', 'trust'],
    rev: ['recklessness', 'hesitation', 'naivety', 'a step not taken'],
    meaning:
      'The Fool suggests a threshold: something is about to begin and you do not yet know how it goes. The card tends to point to openness rather than planning — travelling light, saying yes before the case is fully made. One way to read it is as an invitation to notice where you are being asked to trust the next step.',
    reversed:
      'Reversed, the Fool may point to a leap taken without looking, or to a beginning you keep postponing because it cannot be made safe first. Ask which of the two is closer.',
    symbolism:
      'A young traveller steps toward a cliff edge with a small bundle and a white rose, a dog at their heels and the sun behind. The pack is light, the gaze is upward: the image is about what you carry into the unknown, not the drop.',
  }),
  major({
    number: 1,
    name: 'The Magician',
    element: 'air',
    astrology: 'Mercury',
    correspondences: { element: 'air', planet: 'Mercury' },
    up: ['skill', 'will', 'resourcefulness', 'focus', 'making it happen'],
    rev: ['manipulation', 'scattered effort', 'untapped ability', 'trickery'],
    meaning:
      'The Magician points to capacity: the tools for the matter are already on the table and the question is whether you pick them up. It often suggests a moment where intention and means line up, and where directing attention is the work itself. Consider what you already know how to do here.',
    reversed:
      'Reversed, the card may suggest skill without direction — energy spent in several directions at once — or a cleverness that is being used to persuade rather than to build.',
    symbolism:
      'A figure stands at a table holding a wand to the sky and pointing to the ground, the four suit emblems laid out before them, a lemniscate above the head. Roses and lilies frame the scene: desire and thought, both cultivated.',
  }),
  major({
    number: 2,
    name: 'The High Priestess',
    element: 'water',
    astrology: 'The Moon',
    correspondences: { element: 'water', planet: 'Moon' },
    up: ['intuition', 'the unspoken', 'stillness', 'inner knowing', 'waiting'],
    rev: ['secrets kept too long', 'ignored instinct', 'surface only', 'withdrawal'],
    meaning:
      'The High Priestess suggests that what matters here is not yet visible and does not need to be forced. The card tends to favour listening over acting — sitting with a question until it answers itself. One way to read it: something you already sense is more reliable than what you have been told.',
    reversed:
      'Reversed, it may point to intuition overridden by noise, or to a silence that has become avoidance rather than patience.',
    symbolism:
      'A seated woman between a black and a white pillar, a scroll marked TORA half hidden in her robe, a crescent at her feet and a veil of pomegranates behind her. The veil is the point: the image is about what stays behind it.',
  }),
  major({
    number: 3,
    name: 'The Empress',
    element: 'earth',
    astrology: 'Venus',
    correspondences: { element: 'earth', planet: 'Venus' },
    up: ['abundance', 'nurture', 'growth', 'the body', 'creativity'],
    rev: ['neglect', 'smothering', 'creative block', 'dependence'],
    meaning:
      'The Empress points to growth that comes from tending rather than pushing. It often suggests care, comfort, the senses, and things ripening at their own pace — a project, a relationship, a season of your life. Consider what is being fed here, and what is asking to be.',
    reversed:
      'Reversed, the card may suggest care that has tipped into control, or a fertile situation left unattended. It can also mark a time when your own needs have gone unfed.',
    symbolism:
      'A crowned woman reclines on cushions in a field of ripe wheat, a heart-shaped shield with the sign of Venus beside her, a waterfall and forest behind. Everything in the frame is in fruit.',
  }),
  major({
    number: 4,
    name: 'The Emperor',
    element: 'fire',
    astrology: 'Aries',
    correspondences: { element: 'fire', zodiac: 'Aries' },
    up: ['structure', 'authority', 'boundaries', 'stability', 'responsibility'],
    rev: ['rigidity', 'domination', 'lack of discipline', 'abdicated authority'],
    meaning:
      'The Emperor suggests order held in place by someone willing to hold it. The card tends to point to rules, boundaries and long-term responsibility — the part of a situation that needs a firm hand rather than a warm one. Ask where structure would actually help, and who is providing it.',
    reversed:
      'Reversed, the Emperor may point to control that has become rigid or to authority nobody is exercising, leaving things to drift.',
    symbolism:
      'A bearded ruler sits on a stone throne carved with rams, an ankh in one hand and an orb in the other, armour showing beneath red robes against bare mountains. Nothing soft is in the picture; that is the message.',
  }),
  major({
    number: 5,
    name: 'The Hierophant',
    element: 'earth',
    astrology: 'Taurus',
    correspondences: { element: 'earth', zodiac: 'Taurus' },
    up: ['tradition', 'teaching', 'shared belief', 'institutions', 'guidance'],
    rev: ['dogma', 'rebellion', 'a personal path', 'questioning received wisdom'],
    meaning:
      'The Hierophant points to what is handed down: teachers, traditions, communities and the rules they keep. It often suggests learning from an established path, or seeking advice from someone who has walked it. One way to read it is as a question about which conventions serve you and which you simply inherited.',
    reversed:
      'Reversed, the card may suggest a break from convention or a teaching that no longer fits, and the discomfort of finding your own way through.',
    symbolism:
      'A robed figure raises a hand in blessing between two pillars, holding a triple cross, with two tonsured acolytes below and crossed keys at their feet. The keys are what is being passed on.',
  }),
  major({
    number: 6,
    name: 'The Lovers',
    element: 'air',
    astrology: 'Gemini',
    correspondences: { element: 'air', zodiac: 'Gemini' },
    up: ['union', 'choice', 'values', 'alignment', 'intimacy'],
    rev: ['disharmony', 'misalignment', 'avoidance of a choice', 'imbalance'],
    meaning:
      'The Lovers suggests a meeting — of two people, or of your values with your actions. In Waite’s deck the card is less about romance than about a choice that reveals what you hold dear. Consider what the situation is asking you to commit to, and whether both halves of you agree.',
    reversed:
      'Reversed, it may point to a relationship or decision out of step with your values, or to a choice being deferred because both options cost something.',
    symbolism:
      'A naked man and woman stand beneath an angel with outstretched wings; behind her the tree of flame and the tree of fruit with the serpent, a mountain between them. The woman looks to the angel, the man to the woman.',
  }),
  major({
    number: 7,
    name: 'The Chariot',
    element: 'water',
    astrology: 'Cancer',
    correspondences: { element: 'water', zodiac: 'Cancer' },
    up: ['determination', 'momentum', 'self-mastery', 'direction', 'victory through will'],
    rev: ['loss of control', 'scattered drive', 'aggression', 'stalled progress'],
    meaning:
      'The Chariot points to movement held together by will. It often suggests progress that depends on steering two forces that would otherwise pull apart — ambition and caution, head and heart. One way to read it: the way forward is open, but only if you keep your hands on the reins.',
    reversed:
      'Reversed, the card may suggest drive without direction, or effort that pushes against itself. It can mark a moment to stop and ask where you are actually trying to go.',
    symbolism:
      'An armoured figure stands in a stone chariot beneath a starry canopy, drawn by one black and one white sphinx, a walled city behind. There are no reins; the charioteer holds only a wand.',
  }),
  major({
    number: 8,
    name: 'Strength',
    element: 'fire',
    astrology: 'Leo',
    correspondences: { element: 'fire', zodiac: 'Leo' },
    up: ['gentle strength', 'patience', 'courage', 'compassion', 'inner resolve'],
    rev: ['self-doubt', 'force', 'raw impulse', 'weakness of resolve'],
    meaning:
      'Strength suggests a power that does not need to raise its voice. The card tends to point to patience, steadiness and the quiet handling of something wild — an appetite, a fear, another person’s anger. Consider where gentleness is currently doing more than force could.',
    reversed:
      'Reversed, Strength may point to confidence that has slipped, or to a situation where you are trying to overpower what needs to be soothed instead.',
    symbolism:
      'A woman in white closes the jaws of a lion with her bare hands, a lemniscate over her head and a garland of flowers at her waist. The lion is not defeated; it is calm.',
  }),
  major({
    number: 9,
    name: 'The Hermit',
    element: 'earth',
    astrology: 'Virgo',
    correspondences: { element: 'earth', zodiac: 'Virgo' },
    up: ['solitude', 'searching', 'inner guidance', 'withdrawal', 'wisdom'],
    rev: ['isolation', 'loneliness', 'refusing help', 'withdrawal as avoidance'],
    meaning:
      'The Hermit points to time spent apart in order to see clearly. It often suggests a deliberate step back from company and noise, with a question that needs your own answer rather than a consensus. One way to read it: the light you are looking for is the one you are carrying.',
    reversed:
      'Reversed, the card may suggest solitude that has become isolation, or a reluctance to come back down the mountain and share what you found.',
    symbolism:
      'A cloaked elder stands on a snowy peak holding a lantern with a six-pointed star inside and a staff in the other hand. The light is held low, for the next step, not for the horizon.',
  }),
  major({
    number: 10,
    name: 'Wheel of Fortune',
    element: 'fire',
    astrology: 'Jupiter',
    correspondences: { element: 'fire', planet: 'Jupiter' },
    up: ['turning points', 'cycles', 'chance', 'change', 'what is outside your control'],
    rev: ['resistance to change', 'a setback', 'the same loop again', 'bad timing'],
    meaning:
      'The Wheel suggests that circumstances are moving on their own. It tends to point to cycles — a season ending, a pattern repeating, luck shifting — and to the limits of what you can steer. Consider what has changed around you lately and how you have positioned yourself on the wheel.',
    reversed:
      'Reversed, it may point to clinging to a phase that is over, or to a turn of events that feels like a reversal of fortune. It can also mark a pattern you have been through before.',
    symbolism:
      'A great wheel inscribed with TARO and the Hebrew letters of the divine name, a sphinx on top, a serpent descending and a jackal-headed figure rising, four winged creatures reading in the corners. Everyone on the wheel is moving.',
  }),
  major({
    number: 11,
    name: 'Justice',
    element: 'air',
    astrology: 'Libra',
    correspondences: { element: 'air', zodiac: 'Libra' },
    up: ['fairness', 'truth', 'consequence', 'clarity', 'accountability'],
    rev: ['unfairness', 'avoiding responsibility', 'bias', 'a decision dodged'],
    meaning:
      'Justice points to cause and consequence weighed honestly. It often suggests a decision that needs clear thinking rather than sympathy, or an outcome that follows from what was done. One way to read it: the situation is asking you to see it exactly as it is, including your part.',
    reversed:
      'Reversed, the card may suggest a judgement that is off balance, a truth being avoided, or accountability that has not been taken up.',
    symbolism:
      'A crowned figure sits between two pillars with an upright sword in the right hand and scales in the left, a purple veil behind. The sword is raised, not swung: discernment before action.',
  }),
  major({
    number: 12,
    name: 'The Hanged Man',
    element: 'water',
    astrology: 'Water (Neptune in modern practice)',
    correspondences: { element: 'water', planet: 'Neptune' },
    up: ['suspension', 'surrender', 'a new angle', 'pause', 'letting go'],
    rev: ['stalling', 'resistance', 'pointless sacrifice', 'holding on'],
    meaning:
      'The Hanged Man suggests a pause you did not choose, and a view that only becomes available from it. The card tends to point to surrender rather than defeat — letting a matter hang until it shows a side you could not see standing up. Consider what you might gain by not acting yet.',
    reversed:
      'Reversed, it may point to a delay that has become a stall, or to a sacrifice that is not changing anything and could be set down.',
    symbolism:
      'A young man hangs by one foot from a living T-shaped tree, the other leg crossed behind, hands behind his back, a bright halo around his head. His face is serene; the posture is deliberate.',
  }),
  major({
    number: 13,
    name: 'Death',
    element: 'water',
    astrology: 'Scorpio',
    correspondences: { element: 'water', zodiac: 'Scorpio' },
    up: ['ending', 'transformation', 'release', 'transition', 'clearing'],
    rev: ['resisting an ending', 'stagnation', 'a slow decay', 'fear of change'],
    meaning:
      'Death points to an ending that makes room. It rarely suggests a literal death; more often it marks a chapter closing so definitively that what follows cannot look like what came before. One way to read it is as a question about what you are ready to let end, and what will grow in the cleared ground.',
    reversed:
      'Reversed, the card may suggest an ending being resisted long past its time, so that change arrives slowly and painfully instead of cleanly.',
    symbolism:
      'A skeleton in black armour rides a white horse carrying a banner with a white rose; a king lies fallen, a bishop pleads, a child offers flowers, and the sun rises between two towers in the distance.',
  }),
  major({
    number: 14,
    name: 'Temperance',
    element: 'fire',
    astrology: 'Sagittarius',
    correspondences: { element: 'fire', zodiac: 'Sagittarius' },
    up: ['balance', 'moderation', 'blending', 'patience', 'healing'],
    rev: ['excess', 'imbalance', 'impatience', 'competing demands'],
    meaning:
      'Temperance suggests a middle way found by careful mixing rather than by choosing sides. The card tends to point to patience, proportion and the slow work of bringing opposites into one flow. Consider where you are being asked to combine rather than decide.',
    reversed:
      'Reversed, it may point to something out of proportion — too much of one thing, too little of another — or to a healing process being rushed.',
    symbolism:
      'A winged angel with one foot in a pool and one on land pours water between two cups, a triangle on the chest and a path leading to a crown of light in the mountains. The water flows at an impossible angle.',
  }),
  major({
    number: 15,
    name: 'The Devil',
    element: 'earth',
    astrology: 'Capricorn',
    correspondences: { element: 'earth', zodiac: 'Capricorn' },
    up: ['attachment', 'compulsion', 'materialism', 'shadow', 'what binds you'],
    rev: ['release', 'facing the shadow', 'breaking a pattern', 'reclaiming choice'],
    meaning:
      'The Devil points to a bond that feels stronger than it is. It often suggests habits, dependencies or arrangements that keep you in place by seeming inevitable. One way to read the card: look at the chains closely enough to notice how loosely they fit.',
    reversed:
      'Reversed, it may suggest the loosening of an attachment — a pattern seen clearly enough to step out of, though not without effort.',
    symbolism:
      'A horned figure squats on a black pedestal with an inverted pentagram on its brow; a naked man and woman stand chained below, with small horns and tails of their own. The chains are loose around their necks.',
  }),
  major({
    number: 16,
    name: 'The Tower',
    element: 'fire',
    astrology: 'Mars',
    correspondences: { element: 'fire', planet: 'Mars' },
    up: ['sudden change', 'upheaval', 'revelation', 'collapse of a structure', 'release'],
    rev: ['a disaster averted', 'fear of change', 'a slow crumble', 'resisting the inevitable'],
    meaning:
      'The Tower suggests something built on a false footing coming down fast. The card tends to point to shock, disruption and the clarity that follows it — a truth arriving in a way that cannot be unsaid. Consider what in your situation was already unstable before it broke.',
    reversed:
      'Reversed, the Tower may point to a collapse that is being postponed rather than avoided, or to an upheaval whose worst has already passed.',
    symbolism:
      'Lightning strikes a tower on a crag, knocking off its crown; flames burst from the windows and two figures fall headlong through the dark as sparks shaped like the letter yod rain down.',
  }),
  major({
    number: 17,
    name: 'The Star',
    element: 'air',
    astrology: 'Aquarius',
    correspondences: { element: 'air', zodiac: 'Aquarius' },
    up: ['hope', 'renewal', 'openness', 'calm after a storm', 'faith'],
    rev: ['discouragement', 'lost faith', 'disconnection', 'hope withheld'],
    meaning:
      'The Star points to quiet renewal after difficulty. It often suggests hope that does not need proof, a sense of being able to breathe again, and a willingness to be seen without defences. One way to read it: something is being replenished, even if the results are not visible yet.',
    reversed:
      'Reversed, the card may suggest a hope that has thinned, or a moment when you have stopped believing that things can improve. The well is still there.',
    symbolism:
      'A naked woman kneels by a pool, pouring water from two jugs onto land and water, beneath one large eight-pointed star and seven smaller ones; an ibis rests in a tree behind her.',
  }),
  major({
    number: 18,
    name: 'The Moon',
    element: 'water',
    astrology: 'Pisces',
    correspondences: { element: 'water', zodiac: 'Pisces' },
    up: ['uncertainty', 'intuition', 'the unconscious', 'illusion', 'fear'],
    rev: ['clarity returning', 'a fear named', 'confusion lifting', 'self-deception'],
    meaning:
      'The Moon suggests a path walked without a clear view. The card tends to point to anxiety, half-truths, and the strange logic of dreams and instincts — a time when what you feel is louder than what you know. Consider what you might be projecting onto the situation, and what your gut is genuinely picking up.',
    reversed:
      'Reversed, it may suggest confusion beginning to lift, or a fear that loses its power once it is said aloud.',
    symbolism:
      'A moon with a downturned face drips light over a path between two towers, a dog and a wolf howling, a crayfish crawling out of a pool at the bottom of the frame.',
  }),
  major({
    number: 19,
    name: 'The Sun',
    element: 'fire',
    astrology: 'The Sun',
    correspondences: { element: 'fire', planet: 'Sun' },
    up: ['joy', 'vitality', 'clarity', 'warmth', 'success'],
    rev: ['dimmed joy', 'overexposure', 'naive optimism', 'a delay in good news'],
    meaning:
      'The Sun points to plain, uncomplicated good. It often suggests clarity, warmth, energy and the relief of nothing being hidden. One way to read it: the situation is simpler and kinder than you have been bracing for.',
    reversed:
      'Reversed, the card may suggest a joy muted by circumstances, or brightness that has become glare — optimism unwilling to look at what is in shadow.',
    symbolism:
      'A naked child rides a white horse beneath a huge radiant sun, holding a red banner; sunflowers rise over a wall behind. There is nowhere in the picture that is not lit.',
  }),
  major({
    number: 20,
    name: 'Judgement',
    element: 'fire',
    astrology: 'Fire (Pluto in modern practice)',
    correspondences: { element: 'fire', planet: 'Pluto' },
    up: ['reckoning', 'awakening', 'a call', 'renewal', 'forgiveness'],
    rev: ['self-doubt', 'ignoring the call', 'harsh self-judgement', 'stuck in the past'],
    meaning:
      'Judgement suggests a call to rise and answer for what has been. The card tends to point to a moment of honest review — what you did, what you owe, what you are ready to leave behind — followed by a kind of release. Consider what you would say if you were asked to account for this chapter.',
    reversed:
      'Reversed, it may point to a summons you are declining to hear, or to a self-judgement so severe that it prevents moving on.',
    symbolism:
      'An angel blows a trumpet with a red-cross banner from the clouds while grey figures rise from coffins on the water with open arms, mountains of ice behind them.',
  }),
  major({
    number: 21,
    name: 'The World',
    element: 'earth',
    astrology: 'Saturn',
    correspondences: { element: 'earth', planet: 'Saturn' },
    up: ['completion', 'integration', 'wholeness', 'arrival', 'a cycle closed'],
    rev: ['incompletion', 'loose ends', 'delay', 'the last step not taken'],
    meaning:
      'The World points to something finished and whole. It often suggests the satisfying close of a long arc — the point at which effort, understanding and circumstance finally match. One way to read it is as an invitation to acknowledge what has been completed before starting the next thing.',
    reversed:
      'Reversed, the card may suggest a cycle that is nearly but not quite done, or a completion you have not allowed yourself to feel.',
    symbolism:
      'A dancing figure wrapped in a purple sash holds a wand in each hand within an oval wreath, the four living creatures of the Wheel now fully formed in the corners.',
  }),
];
