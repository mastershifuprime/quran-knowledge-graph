"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import topicsData from "../../data/topics.json";
import quranArabic from "../../data/quran_arabic.json";
import quranBn from "../../data/quran_bn.json";

interface Topic {
  id: string;
  name: string;
  nameAr: string;
  nameEn: string;
  color: string;
  verses: string[];
}

interface Verse {
  surahId: number;
  verseId: number;
  arabic: string;
  bangla: string;
  surahName: string;
  surahNameAr: string;
  ref: string;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  verseCount: number;
  radius: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  sharedCount: number;
  strength: number;
}

const topics: Topic[] = topicsData.topics;

function buildVerseLookup(): Map<string, { arabic: string; bangla: string; surahName: string; surahNameAr: string }> {
  const lookup = new Map();
  (quranArabic as any[]).forEach((surah, idx) => {
    const bnSurah = (quranBn as any[])[idx];
    surah.verses.forEach((verse: any, vIdx: number) => {
      const ref = `${surah.id}:${verse.id}`;
      lookup.set(ref, {
        arabic: verse.text,
        bangla: bnSurah?.verses?.[vIdx]?.translation || "",
        surahName: surah.transliteration,
        surahNameAr: surah.name,
      });
    });
  });
  return lookup;
}

function buildGraphData() {
  const nodes: GraphNode[] = topics.map((t) => ({
    id: t.id,
    name: t.name,
    nameEn: t.nameEn,
    color: t.color,
    verseCount: t.verses.length,
    radius: Math.max(20, Math.min(50, 10 + Math.sqrt(t.verses.length) * 4)),
  }));

  const links: GraphLink[] = [];
  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const setA = new Set(topics[i].verses);
      const shared = topics[j].verses.filter((v) => setA.has(v));
      if (shared.length > 0) {
        links.push({
          source: topics[i].id,
          target: topics[j].id,
          sharedCount: shared.length,
          strength: Math.min(1, shared.length / 20),
        });
      }
    }
  }

  return { nodes, links };
}

export default function QuranGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const verseLookup = useMemo(() => buildVerseLookup(), []);
  const graphData = useMemo(() => buildGraphData(), []);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const versePanelRef = useRef<HTMLDivElement>(null);

  // When topic is selected, show panel and scroll to top
  useEffect(() => {
    if (selectedTopic) {
      setShowPanel(true);
      // Scroll verse list to top when switching topics
      setTimeout(() => {
        if (versePanelRef.current) {
          const scrollArea = versePanelRef.current.querySelector("[data-verse-list]");
          if (scrollArea) scrollArea.scrollTop = 0;
        }
      }, 50);
    }
  }, [selectedTopic]);

  const closePanel = () => {
    setShowPanel(false);
    setTimeout(() => setSelectedTopic(null), 300);
  };

  const switchTopic = (topicId: string) => {
    const topic = topics.find((x) => x.id === topicId);
    if (topic) setSelectedTopic(topic);
  };

  // Get verses for selected topic
  const selectedVerses = useMemo((): Verse[] => {
    if (!selectedTopic) return [];
    return selectedTopic.verses
      .map((ref) => {
        const [surahId, verseId] = ref.split(":").map(Number);
        const data = verseLookup.get(ref);
        if (!data) return null;
        return { surahId, verseId, arabic: data.arabic, bangla: data.bangla, surahName: data.surahName, surahNameAr: data.surahNameAr, ref };
      })
      .filter(Boolean) as Verse[];
  }, [selectedTopic, verseLookup]);

  // Connected topics
  const connectedTopics = useMemo(() => {
    if (!selectedTopic) return [];
    const selectedSet = new Set(selectedTopic.verses);
    return topics
      .filter((t) => t.id !== selectedTopic.id)
      .map((t) => ({ ...t, sharedCount: t.verses.filter((v) => selectedSet.has(v)).length }))
      .filter((t) => t.sharedCount > 0)
      .sort((a, b) => b.sharedCount - a.sharedCount);
  }, [selectedTopic]);

  // Filter topics by search — matches topic name AND verse text
  const filteredTopics = useMemo(() => {
    if (!searchQuery) return topics;
    const q = searchQuery.toLowerCase();
    return topics.filter((t) => {
      // Match topic name (Bengali, English, Arabic)
      if (t.name.includes(q) || t.nameEn.toLowerCase().includes(q) || t.nameAr.includes(q)) return true;
      // Also match if any verse translation contains the query
      return t.verses.some((ref) => {
        const data = verseLookup.get(ref);
        return data && (data.bangla.includes(searchQuery) || data.arabic.includes(searchQuery));
      });
    });
  }, [searchQuery, verseLookup]);

  // D3 force graph
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const mobile = width < 768;

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // Adjust forces for mobile — fill screen, no dead space
    const nodeScale = mobile ? 0.45 : 1;
    const simulation = d3.forceSimulation<GraphNode>(graphData.nodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(graphData.links).id((d) => d.id).distance(mobile ? 50 : 150).strength((d) => d.strength * (mobile ? 0.6 : 0.3)))
      .force("charge", d3.forceManyBody().strength(mobile ? -80 : -400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX(width / 2).strength(mobile ? 0.2 : 0.05))
      .force("y", d3.forceY(height / 2).strength(mobile ? 0.2 : 0.05))
      .force("collision", d3.forceCollide<GraphNode>().radius((d) => d.radius * nodeScale + 6));

    const link = g.append("g").selectAll("line").data(graphData.links).enter().append("line")
      .attr("stroke", "#333")
      .attr("stroke-width", (d) => mobile ? Math.max(0.5, d.sharedCount / 10) : Math.max(1, d.sharedCount / 5))
      .attr("stroke-opacity", mobile ? 0.25 : 0.4);

    const nodeGroup = g.append("g").selectAll("g").data(graphData.nodes).enter().append("g")
      .attr("class", "graph-node")
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // Glow
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "glow");
    filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    const nodeRadius = (d: GraphNode) => d.radius * nodeScale;

    nodeGroup.append("circle")
      .attr("r", nodeRadius)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", 0.15)
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 2)
      .attr("filter", "url(#glow)")
      .on("mouseover", function (event, d) {
        if (mobile) return; // skip hover on mobile
        d3.select(this).attr("fill-opacity", 0.35).attr("stroke-width", 3);
        link.attr("stroke-opacity", (l: any) => l.source.id === d.id || l.target.id === d.id ? 0.8 : 0.1)
            .attr("stroke", (l: any) => l.source.id === d.id || l.target.id === d.id ? d.color : "#333");
      })
      .on("mouseout", function () {
        if (mobile) return;
        d3.select(this).attr("fill-opacity", 0.15).attr("stroke-width", 2);
        link.attr("stroke-opacity", 0.4).attr("stroke", "#333");
      })
      .on("click", (event, d) => {
        const topic = topics.find((t) => t.id === d.id);
        if (topic) setSelectedTopic(topic);
      });

    // Labels — on mobile show abbreviated, on desktop show full
    if (!mobile) {
      nodeGroup.append("text")
        .text((d) => d.name)
        .attr("text-anchor", "middle")
        .attr("dy", (d) => nodeRadius(d) + 16)
        .attr("fill", "#ccc")
        .attr("font-size", "12px")
        .attr("font-weight", "500")
        .attr("pointer-events", "none");
    } else {
      // On mobile: show short label below node
      nodeGroup.append("text")
        .text((d) => d.name.length > 6 ? d.name.slice(0, 5) + "…" : d.name)
        .attr("text-anchor", "middle")
        .attr("dy", (d) => nodeRadius(d) + 10)
        .attr("fill", "#aaa")
        .attr("font-size", "7px")
        .attr("font-weight", "500")
        .attr("pointer-events", "none");
    }

    // Verse count inside node
    nodeGroup.append("text")
      .text((d) => d.verseCount.toString())
      .attr("text-anchor", "middle")
      .attr("dy", mobile ? "3px" : "5px")
      .attr("fill", (d) => d.color)
      .attr("font-size", mobile ? "8px" : "14px")
      .attr("font-weight", "700")
      .attr("pointer-events", "none");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
      nodeGroup.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Auto-fit: zoom to fit all nodes with padding for header/pills
    const fitToScreen = () => {
      const xs = graphData.nodes.map((d) => d.x || 0);
      const ys = graphData.nodes.map((d) => d.y || 0);
      const maxR = Math.max(...graphData.nodes.map((d) => d.radius * nodeScale)) + 20;
      const minX = Math.min(...xs) - maxR;
      const maxX = Math.max(...xs) + maxR;
      const minY = Math.min(...ys) - maxR;
      const maxY = Math.max(...ys) + maxR;
      const graphW = maxX - minX;
      const graphH = maxY - minY;
      // On mobile, account for header (40px top) and pills (40px bottom)
      const padTop = mobile ? 40 : 0;
      const padBottom = mobile ? 40 : 0;
      const availH = height - padTop - padBottom;
      const scale = Math.min(width / graphW, availH / graphH) * (mobile ? 1.0 : 0.9);
      const tx = (width - graphW * scale) / 2 - minX * scale;
      const ty = padTop + (availH - graphH * scale) / 2 - minY * scale;
      svg.transition().duration(800).call(
        zoom.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
    };
    simulation.on("end", fitToScreen);
    // Also fit after 2 seconds in case simulation is slow
    setTimeout(fitToScreen, 2000);

    return () => { simulation.stop(); };
  }, [graphData, isMobile]);

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen overflow-hidden">
      {/* Graph area */}
      <div className="flex-1 relative min-h-0">
        {/* Header */}
        <div className="absolute top-1 left-2 z-10 md:top-3 md:left-3">
          <h1 className="text-sm md:text-2xl font-bold mb-0">
            <span className="text-[#adfa1d]">القرآن</span>{" "}
            <span className="text-white text-xs md:text-2xl">Knowledge Graph</span>
          </h1>
          <p className="text-[10px] md:text-sm text-gray-500">
            {topics.length} topics · {topics.reduce((s, t) => s + t.verses.length, 0)} verse connections
          </p>
        </div>

        {/* Search */}
        <div className="absolute top-1 right-2 z-10 w-36 md:top-3 md:right-3 md:w-72">
          <input
            type="text"
            placeholder="Search topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-2 py-1 md:px-4 md:py-2 text-xs md:text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#adfa1d]"
          />
          {searchQuery && filteredTopics.length > 0 && (
            <div className="mt-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg max-h-48 md:max-h-60 overflow-y-auto">
              {filteredTopics.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedTopic(t); setSearchQuery(""); }}
                  className="w-full text-left px-3 py-2 hover:bg-[#2a2a2a] flex items-center gap-2"
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <span className="text-sm truncate">{t.name}</span>
                  <span className="text-xs text-gray-500 ml-auto shrink-0">{t.nameEn}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Topic pills — scrollable on mobile, wrap on desktop */}
        <div className="absolute bottom-0 left-0 right-0 z-10 px-2 pb-1 md:px-3 md:pb-2 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent pt-4">
          <div className="flex gap-1 md:gap-2 md:flex-wrap md:justify-center overflow-x-auto pb-1 scrollbar-hide">
            {topics.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTopic(t)}
                className={`px-1.5 py-0.5 md:px-2.5 md:py-1 rounded-full text-[9px] md:text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                  selectedTopic?.id === t.id
                    ? "ring-1 md:ring-2 ring-offset-1 ring-offset-black opacity-100"
                    : "opacity-60 hover:opacity-100"
                }`}
                style={{
                  backgroundColor: t.color + "22",
                  color: t.color,
                  border: `1px solid ${t.color}44`,
                }}
              >
                {isMobile ? t.name : `${t.name} (${t.verses.length})`}
              </button>
            ))}
          </div>
        </div>

        <svg ref={svgRef} className="w-full h-full touch-none" />
      </div>

      {/* Verse panel — slide-up on mobile, side panel on desktop */}
      {selectedTopic && (
        <>
          {/* Mobile backdrop */}
          {isMobile && showPanel && (
            <div className="fixed inset-0 bg-black/50 z-30" onClick={closePanel} />
          )}

          <div
            ref={versePanelRef}
            className={`
              ${isMobile
                ? `fixed bottom-0 left-0 right-0 z-40 rounded-t-2xl transition-transform duration-300 ${showPanel ? "translate-y-0" : "translate-y-full"}`
                : "w-[480px] border-l border-[#2a2a2a]"
              }
              bg-[#0f0f0f] flex flex-col
              ${isMobile ? "max-h-[85vh]" : "h-screen"}
            `}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag handle */}
            {isMobile && (
              <div className="flex justify-center pt-2 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-gray-600" />
              </div>
            )}

            {/* Panel header */}
            <div className="p-3 md:p-4 border-b border-[#2a2a2a] shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 md:w-4 md:h-4 rounded-full shrink-0" style={{ backgroundColor: selectedTopic.color }} />
                  <h2 className="text-base md:text-lg font-bold">{selectedTopic.name}</h2>
                </div>
                <button onClick={closePanel} className="text-gray-500 hover:text-white text-lg p-1">✕</button>
              </div>
              <p className="text-sm text-gray-400">
                {selectedTopic.nameAr} · {selectedTopic.nameEn}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {selectedVerses.length} verses
              </p>

              {/* Connected topics */}
              {connectedTopics.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-1">Connected topics:</p>
                  <div className="flex flex-wrap gap-1">
                    {connectedTopics.slice(0, isMobile ? 5 : 8).map((t) => (
                      <button
                        key={t.id}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); switchTopic(t.id); }}
                        className="px-2 py-0.5 rounded text-xs active:opacity-80"
                        style={{ backgroundColor: t.color + "22", color: t.color, border: `1px solid ${t.color}33` }}
                      >
                        {t.name} ({t.sharedCount})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Verses list */}
            <div data-verse-list className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4 overscroll-contain">
              {selectedVerses.map((verse) => (
                <div
                  key={verse.ref}
                  className="bg-[#1a1a1a] rounded-lg p-3 md:p-4 border border-[#2a2a2a]"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium px-2 py-0.5 rounded"
                      style={{ backgroundColor: selectedTopic.color + "22", color: selectedTopic.color }}>
                      {verse.surahName} ({verse.surahNameAr}) {verse.ref}
                    </span>
                  </div>
                  <p className="arabic-text mb-2 md:mb-3 text-white text-lg md:text-xl">{verse.arabic}</p>
                  <p className="bangla-text text-sm text-gray-300">{verse.bangla}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
