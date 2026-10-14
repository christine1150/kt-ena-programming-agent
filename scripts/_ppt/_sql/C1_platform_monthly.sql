-- C1: 플랫폼별 월별 시계열 (rating / ATS / share / reach)
select target_label,
       year,
       month,
       round(rating::numeric, 5) as rating,
       round(avg_time_spent_seconds::numeric, 0) as ats,
       round(share::numeric, 5) as share,
       round(reach::numeric, 5) as reach
from olife_reference_metrics
where granularity = 'monthly' and dimension = 'platform'
order by target_label, year, month;
