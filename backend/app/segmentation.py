from dataclasses import dataclass


@dataclass(frozen=True)
class Window:
    index: int
    start: int
    end: int


def segment_windows(length: int, sample_rate: int, seconds: float, overlap: float) -> list[Window]:
    size, shared, minimum = round(seconds * sample_rate), round(overlap * sample_rate), round(1.5 * sample_rate)
    if size < minimum or size > 29 * sample_rate or shared < 0 or shared >= size or length < minimum:
        raise ValueError('Invalid segmentation settings or duration')
    windows = []
    start = 0
    while start < length:
        end = min(start + size, length)
        if end - start < minimum:
            start = max(0, length - size)
            end = length
        windows.append(Window(len(windows), start, end))
        if end == length:
            break
        start += size - shared
    return windows
