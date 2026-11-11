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

    def test_yo_punctuation_and_syllables_normalize(self):
        self.assertEqual(locate_line_windows([{'text':'Е|щё раз!'}],heard('еще раз')), {0:(30,31.8)})

    def test_invalid_and_implausibly_wide_words_rejected(self):
        self.assertEqual(locate_line_windows([{'text':'hello world'}],[{'word':'hello','a':-1,'b':2},{'word':'world','a':3,'b':4}]),{})
        self.assertEqual(locate_line_windows([{'text':'hello world'}],[{'word':'hello','a':0,'b':1},{'word':'world','a':50,'b':51}]),{})
        self.assertEqual(locate_line_windows([{'text':'word'}],[{'word':'word','a':float('nan'),'b':1}]),{})


if __name__ == '__main__':
    unittest.main()
