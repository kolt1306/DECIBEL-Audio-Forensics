import statistics
from .schemas import SegmentResult, SuspiciousRegion, ProbabilityStatistics


def risk_for(fake):
    return 'high' if fake >= .7 else 'medium' if fake >= .4 else 'low'


def suspicious_regions(segments: list[SegmentResult]):
    regions = []
    current = None
    for segment in segments:
        if segment.status != 'analyzed' or segment.fake_probability < .4:
            current = None
            continue
        if current is not None and segment.start_seconds <= current.end_seconds:
            current.end_seconds = max(current.end_seconds, segment.end_seconds)
            current.peak_fake_probability = max(current.peak_fake_probability, segment.fake_probability)
            current.risk = risk_for(current.peak_fake_probability)
        else:
            current = SuspiciousRegion(start_seconds=segment.start_seconds, end_seconds=segment.end_seconds,
                risk=risk_for(segment.fake_probability), peak_fake_probability=segment.fake_probability)
            regions.append(current)
    return regions


def timeline_distribution(segments, duration):
    edges = sorted({0., duration, *[s.start_seconds for s in segments], *[s.end_seconds for s in segments]})
    seconds = {'low': 0., 'medium': 0., 'high': 0.}
    for start, end in zip(edges, edges[1:]):
        middle = (start + end) / 2
        active = [s.fake_probability for s in segments if s.status == 'analyzed' and s.start_seconds <= middle < s.end_seconds]
        if active:
            seconds[risk_for(max(active))] += end - start
    analyzed = sum(seconds.values())
    return {key: value / analyzed if analyzed else 0 for key, value in seconds.items()}, analyzed, max(0., duration - analyzed)


def probability_statistics(segments):
    values = [s.fake_probability for s in segments if s.status == 'analyzed']
    return ProbabilityStatistics(mean=statistics.mean(values), median=statistics.median(values), maximum=max(values),
        minimum=min(values), standard_deviation=statistics.pstdev(values))
