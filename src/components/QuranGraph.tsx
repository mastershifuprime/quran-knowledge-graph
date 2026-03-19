"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Build verse lookup
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

// Build graph data
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
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const verseLookup = useMemo(() => buildVerseLookup(), []);
  const graphData = useMemo(() => buildGraphData(), []);

  // Get verses for selected topic
  const selectedVerses = useMemo((): Verse[] => {
    if (!selectedTopic) return [];
    return selectedTopic.verses
      .map((ref) => {
        const [surahId, verseId] = ref.split(":").map(Number);
        const data = verseLookup.get(ref);
        if (!data) return null;
        return {
          surahId,
          verseId,
          arabic: data.arabic,
          bangla: data.bangla,
          surahName: data.surahName,
          surahNameAr: data.surahNameAr,
          ref,
        };
      })
      .filter(Boolean) as Verse[];
  }, [selectedTopic, verseLookup]);

  // Connected topics
  const connectedTopics = useMemo(() => {
    if (!selectedTopic) return [];
    const selectedSet = new Set(selectedTopic.verses);
    return topics
      .filter((t) => t.id !== selectedTopic.id)
      .map((t) => ({
        ...t,
        sharedCount: t.verses.filter((v) => selectedSet.has(v)).length,
      }))
      .filter((t) => t.sharedCount > 0)
      .sort((a, b) => b.sharedCount - a.sharedCount);
  }, [selectedTopic]);

  // Filter topics by search
  const filteredTopics = useMemo(() => {
    if (!searchQuery) return topics;
    const q = searchQuery.toLowerCase();
    return topics.filter(
      (t) =>
        t.name.includes(q) ||
        t.nameEn.toLowerCase().includes(q) ||
        t.nameAr.includes(q)
    );
  }, [searchQuery]);

  // D3 force graph
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const g = svg.append("g");

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // Simulation
    const simulation = d3.forceSimulation<GraphNode>(graphData.nodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(graphData.links).id((d) => d.id).distance(150).strength((d) => d.strength * 0.3))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<GraphNode>().radius((d) => d.radius + 10));

    // Links
    const link = g
      .append("g")
      .selectAll("line")
      .data(graphData.links)
      .enter()
      .append("line")
      .attr("stroke", "#333")
      .attr("stroke-width", (d) => Math.max(1, d.sharedCount / 5))
      .attr("stroke-opacity", 0.4);

    // Node groups
    const nodeGroup = g
      .append("g")
      .selectAll("g")
      .data(graphData.nodes)
      .enter()
      .append("g")
      .attr("class", "graph-node")
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Glow effect
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "glow");
    filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Circles
    nodeGroup
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", 0.15)
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 2)
      .attr("filter", "url(#glow)")
      .on("mouseover", function (event, d) {
        d3.select(this).attr("fill-opacity", 0.35).attr("stroke-width", 3);
        setHoveredNode(d.id);
        // Highlight connected links
        link.attr("stroke-opacity", (l: any) =>
          l.source.id === d.id || l.target.id === d.id ? 0.8 : 0.1
        ).attr("stroke", (l: any) =>
          l.source.id === d.id || l.target.id === d.id ? d.color : "#333"
        );
      })
      .on("mouseout", function () {
        d3.select(this).attr("fill-opacity", 0.15).attr("stroke-width", 2);
        setHoveredNode(null);
        link.attr("stroke-opacity", 0.4).attr("stroke", "#333");
      })
      .on("click", (event, d) => {
        const topic = topics.find((t) => t.id === d.id);
        if (topic) setSelectedTopic(topic);
      });

    // Labels
    nodeGroup
      .append("text")
      .text((d) => d.name)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => d.radius + 16)
      .attr("fill", "#ccc")
      .attr("font-size", "12px")
      .attr("font-weight", "500")
      .attr("pointer-events", "none");

    // Verse count
    nodeGroup
      .append("text")
      .text((d) => d.verseCount.toString())
      .attr("text-anchor", "middle")
      .attr("dy", "5px")
      .attr("fill", (d) => d.color)
      .attr("font-size", "14px")
      .attr("font-weight", "700")
      .attr("pointer-events", "none");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      nodeGroup.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Initial zoom to fit
    svg.call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(0.85));

    return () => { simulation.stop(); };
  }, [graphData]);

  return (
    <div className="flex h-screen w-screen">
      {/* Graph area */}
      <div className="flex-1 relative">
        {/* Header */}
        <div className="absolute top-4 left-4 z-10">
          <h1 className="text-2xl font-bold mb-1">
            <span className="text-[#adfa1d]">القرآن</span>{" "}
            <span className="text-white">Knowledge Graph</span>
          </h1>
          <p className="text-sm text-gray-500">
            {topics.length} topics · {topics.reduce((s, t) => s + t.verses.length, 0)} verse connections
          </p>
        </div>

        {/* Search */}
        <div className="absolute top-4 right-4 z-10 w-72">
          <input
            type="text"
            placeholder="Search topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#adfa1d]"
          />
          {searchQuery && filteredTopics.length > 0 && (
            <div className="mt-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg max-h-60 overflow-y-auto">
              {filteredTopics.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedTopic(t); setSearchQuery(""); }}
                  className="w-full text-left px-4 py-2 hover:bg-[#2a2a2a] flex items-center gap-2"
                >
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="text-sm">{t.name}</span>
                  <span className="text-xs text-gray-500 ml-auto">{t.nameEn}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Topic pills at bottom */}
        <div className="absolute bottom-4 left-4 right-4 z-10 flex flex-wrap gap-2 justify-center">
          {topics.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTopic(t)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                selectedTopic?.id === t.id
                  ? "ring-2 ring-offset-1 ring-offset-black"
                  : "opacity-70 hover:opacity-100"
              }`}
              style={{
                backgroundColor: t.color + "22",
                color: t.color,
                borderColor: t.color,
                border: `1px solid ${t.color}44`,
                ...(selectedTopic?.id === t.id ? { ringColor: t.color } : {}),
              }}
            >
              {t.name} ({t.verses.length})
            </button>
          ))}
        </div>

        <svg ref={svgRef} className="w-full h-full" />
      </div>

      {/* Verse panel (right side) */}
      {selectedTopic && (
        <div className="w-[480px] bg-[#0f0f0f] border-l border-[#2a2a2a] flex flex-col h-screen">
          {/* Panel header */}
          <div className="p-4 border-b border-[#2a2a2a] shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: selectedTopic.color }} />
                <h2 className="text-lg font-bold">{selectedTopic.name}</h2>
              </div>
              <button
                onClick={() => setSelectedTopic(null)}
                className="text-gray-500 hover:text-white text-xl"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-gray-400">
              {selectedTopic.nameAr} · {selectedTopic.nameEn}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {selectedVerses.length} verses
            </p>

            {/* Connected topics */}
            {connectedTopics.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-1">Connected topics:</p>
                <div className="flex flex-wrap gap-1">
                  {connectedTopics.slice(0, 8).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTopic(topics.find((x) => x.id === t.id)!)}
                      className="px-2 py-0.5 rounded text-xs"
                      style={{
                        backgroundColor: t.color + "22",
                        color: t.color,
                        border: `1px solid ${t.color}33`,
                      }}
                    >
                      {t.name} ({t.sharedCount})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Verses list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedVerses.map((verse) => (
              <div
                key={verse.ref}
                className="bg-[#1a1a1a] rounded-lg p-4 border border-[#2a2a2a] hover:border-[#333]"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded"
                    style={{ backgroundColor: selectedTopic.color + "22", color: selectedTopic.color }}>
                    {verse.surahName} ({verse.surahNameAr}) {verse.ref}
                  </span>
                </div>
                <p className="arabic-text mb-3 text-white">{verse.arabic}</p>
                <p className="bangla-text text-sm text-gray-300">{verse.bangla}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
