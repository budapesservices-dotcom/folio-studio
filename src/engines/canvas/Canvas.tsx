import type { DesignNode, FolioDocument } from '../../core/document/types';

interface CanvasProps {
  document: FolioDocument;
  selectedNodeId: string | null;
  zoom: number;
  onSelect: (nodeId: string | null) => void;
}

function NodeArtwork({ node, onSelect }: {
  node: DesignNode;
  onSelect: (nodeId: string) => void;
}) {
  const transform = node.rotation ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})` : undefined;
  const common = {
    opacity: node.opacity,
    onClick: (event: MouseEvent) => {
      event.stopPropagation();
      if (!node.locked) onSelect(node.id);
    },
    style: { cursor: node.locked ? 'default' : 'pointer' },
  };

  return (
    <g transform={transform}>
      {node.type === 'rect' && (
        <rect
          {...common}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={node.style.radius ?? 0}
          fill={node.style.fill}
          stroke={node.style.stroke}
          strokeWidth={node.style.strokeWidth}
        />
      )}
      {node.type === 'ellipse' && (
        <ellipse
          {...common}
          cx={node.x + node.width / 2}
          cy={node.y + node.height / 2}
          rx={node.width / 2}
          ry={node.height / 2}
          fill={node.style.fill}
          stroke={node.style.stroke}
          strokeWidth={node.style.strokeWidth}
        />
      )}
      {node.type === 'text' && (
        <text
          {...common}
          x={node.x}
          y={node.y}
          fill={node.style.fill}
          fontSize={node.style.fontSize}
          fontFamily={node.style.fontFamily}
          fontWeight={node.style.fontWeight}
          letterSpacing={node.style.letterSpacing}
          dominantBaseline="hanging"
        >
          {node.text.split('\n').map((line, index) => (
            <tspan key={`${node.id}-${index}`} x={node.x} dy={index === 0 ? 0 : node.style.fontSize * node.style.lineHeight}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}


function SelectionOutline({ node }: { node: DesignNode }) {
  const transform = node.rotation
    ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`
    : undefined;

  return (
    <g transform={transform} pointerEvents="none">
      <rect
        x={node.x - 7}
        y={node.y - 7}
        width={node.width + 14}
        height={node.height + 14}
        fill="none"
        stroke="#8B7CF6"
        strokeWidth="2"
        strokeDasharray="7 5"
      />
    </g>
  );
}

export function Canvas({ document, selectedNodeId, zoom, onSelect }: CanvasProps) {
  const selectedNode = document.nodes.find((node) => node.id === selectedNodeId && node.visible) ?? null;
  return (
    <div class="canvas-scroll-area">
      <div class="canvas-stage" style={{ width: `${zoom * 100}%` }}>
        <div class="artboard-label">
          <span>{document.name}</span>
          <span>{document.width} × {document.height}</span>
        </div>
        <svg
          class="artboard"
          viewBox={`0 0 ${document.width} ${document.height}`}
          role="img"
          aria-label="Folio design artboard"
          onClick={() => onSelect(null)}
        >
          <rect x="0" y="0" width={document.width} height={document.height} fill={document.background} />
          {document.nodes.filter((node) => node.visible).map((node) => (
            <NodeArtwork
              key={node.id}
              node={node}
              onSelect={onSelect}
            />
          ))}
          {selectedNode && <SelectionOutline node={selectedNode} />}
        </svg>
      </div>
    </div>
  );
}
