import copy
import unittest
from line_windows import locate_line_windows


def heard(text, start=30):
    return [{'word': token, 'a': start+i, 'b': start+i+.8} for i, token in enumerate(text.split())]


class LineWindowsTest(unittest.TestCase):
    def test_finds_known_text_far_from_guessed_times_without_mutating_it(self):
        lines=[{'text':'ти|хое мо|ре','t':0,'end':3}, {'text':'снова встречает нас','t':3,'end':6}]
        original=copy.deepcopy(lines)
        self.assertEqual(locate_line_windows(lines,heard('тихое море снова встречает нас')), {0:(30,31.8),1:(32,34.8)})
        self.assertEqual(lines, original)

    def test_unmatched_edges_and_low_coverage_are_not_invented(self):
        self.assertEqual(locate_line_windows([{'text':'совсем другие слова'}],heard('другие слова')), {})
        self.assertEqual(locate_line_windows([{'text':'один два три четыре пять'}],heard('один пять')), {})

    def test_repeated_single_word_does_not_anchor_itself(self):
        self.assertEqual(locate_line_windows([{'text':'да'},{'text':'да'}],heard('да да')), {})

    def test_repeated_lines_stay_ordered_with_context(self):
        lines=[{'text':'это припев'},{'text':'а это куплет'},{'text':'это припев'}]
        self.assertEqual(list(locate_line_windows(lines,heard('это припев а это куплет это припев')).values()), [(30,31.8),(32,34.8),(35,36.8)])

    def test_two_identical_choruses_match_their_own_occurrences(self):
        lines = [{'text': 'это припев'}, {'text': 'это припев'}]
        self.assertEqual(locate_line_windows(lines, heard('это припев', 10) + heard('это припев', 60)), {0: (10, 11.8), 1: (60, 61.8)})

    def test_missing_repeat_is_ambiguous_not_assigned_to_the_first_line(self):
        lines = [{'text': 'это припев'}, {'text': 'это припев'}]
        self.assertEqual(locate_line_windows(lines, heard('это припев', 60)), {})

    def test_extra_asr_repeat_is_not_arbitrarily_chosen(self):
        self.assertEqual(locate_line_windows([{'text': 'это припев'}], heard('это припев', 10) + heard('это припев', 60)), {})

    def test_manual_first_half_disambiguates_later_repeat_even_if_asr_missed_first(self):
        lines = [{'text': 'это припев'}, {'text': 'ручная фраза'}, {'text': 'это припев', 't': 0, 'end': 3}]
        anchors = {0: (10, 12), 1: (30, 32)}
        self.assertEqual(locate_line_windows(lines, heard('это припев', 60), anchors), {**anchors, 2: (60, 61.8)})

    def test_manual_neighbors_bound_search_both_before_and_after(self):
        lines = [{'text': 'опора слева'}, {'text': 'это припев'}, {'text': 'опора справа'}]
        anchors = {0: (30, 32), 2: (90, 92)}
        words = heard('это припев', 10) + heard('это припев', 60) + heard('это припев', 120)
        self.assertEqual(locate_line_windows(lines, words, anchors), {0: (30, 32), 1: (60, 61.8), 2: (90, 92)})

    def test_draft_line_times_do_not_disambiguate_a_missing_repeat(self):
        lines = [{'text': 'это припев', 't': 10, 'end': 12}, {'text': 'это припев', 't': 60, 'end': 62}]
        self.assertEqual(locate_line_windows(lines, heard('это припев', 60)), {})

    def test_context_after_missing_first_repeat_identifies_second(self):
        lines = [{'text': 'это припев'}, {'text': 'другой куплет'}, {'text': 'это припев'}]
        self.assertEqual(locate_line_windows(lines, heard('другой куплет это припев', 50)), {1: (50, 51.8), 2: (52, 53.8)})

    def test_inner_asr_word_can_be_missing_without_losing_ordered_repeat(self):
        lines = [{'text': 'один два три четыре пять'}, {'text': 'один два три четыре пять'}]
        self.assertEqual(locate_line_windows(lines, heard('один два четыре пять', 10) + heard('один два три четыре пять', 60)), {0: (10, 13.8), 1: (60, 64.8)})

    def test_yo_punctuation_and_syllables_normalize(self):
        self.assertEqual(locate_line_windows([{'text':'Е|щё раз!'}],heard('еще раз')), {0:(30,31.8)})

    def test_invalid_and_implausibly_wide_words_rejected(self):
        self.assertEqual(locate_line_windows([{'text':'hello world'}],[{'word':'hello','a':-1,'b':2},{'word':'world','a':3,'b':4}]),{})
        self.assertEqual(locate_line_windows([{'text':'hello world'}],[{'word':'hello','a':0,'b':1},{'word':'world','a':50,'b':51}]),{})
        self.assertEqual(locate_line_windows([{'text':'word'}],[{'word':'word','a':float('nan'),'b':1}]),{})


if __name__ == '__main__':
    unittest.main()
