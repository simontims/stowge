"""Time init_db() (create_all + startup migrations) twice on a DB file.
usage (from api/): PYTHONPATH=. python ../scripts/perf/db/bench_startup.py DB_FILE
"""
import os, sys, time
os.environ["DATABASE_URL"] = "sqlite:///" + sys.argv[1]
t = time.perf_counter()
import stowge.main as m  # import runs init_db() once
print(f"import+init_db #1  {(time.perf_counter()-t)*1000:8.1f} ms")
import cProfile, pstats
for i in (2, 3):
    t = time.perf_counter(); m.init_db(); print(f"init_db #{i}         {(time.perf_counter()-t)*1000:8.1f} ms")
if "--profile" in sys.argv:
    pr = cProfile.Profile(); pr.enable(); m.init_db(); pr.disable()
    pstats.Stats(pr).sort_stats("cumtime").print_stats(14)
