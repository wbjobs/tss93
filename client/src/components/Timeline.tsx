import React, { useState, useEffect, useRef } from 'react';

interface TimelineEvent {
  timestamp: number;
  type: string;
  description: string;
}

interface TimelineProps {
  events: TimelineEvent[];
  startTime: number;
  endTime: number;
  currentTime: number;
  isPlaying: boolean;
  onTimeChange: (timestamp: number) => void;
  onPlayPause: () => void;
  onCreateBranch: (timestamp: number) => void;
}

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const getEventColor = (type: string): string => {
  switch (type) {
    case 'add':
      return '#10b981';
    case 'update':
      return '#3b82f6';
    case 'delete':
      return '#ef4444';
    case 'move':
      return '#8b5cf6';
    case 'collapse':
    case 'uncollapse':
      return '#f59e0b';
    case 'branch_create':
      return '#06b6d4';
    default:
      return '#94a3b8';
  }
};

export const Timeline: React.FC<TimelineProps> = ({
  events,
  startTime,
  endTime,
  currentTime,
  isPlaying,
  onTimeChange,
  onPlayPause,
  onCreateBranch,
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredEvent, setHoveredEvent] = useState<TimelineEvent | null>(null);

  const totalDuration = endTime - startTime || 1;
  const progress = ((currentTime - startTime) / totalDuration) * 100;

  const handleSliderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = startTime + percentage * totalDuration;
    onTimeChange(Math.max(startTime, Math.min(endTime, newTime)));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleSliderClick(e);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !sliderRef.current) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
      const newTime = startTime + percentage * totalDuration;
      onTimeChange(Math.max(startTime, Math.min(endTime, newTime)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, startTime, endTime, totalDuration, onTimeChange]);

  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <div className="timeline-controls">
          <button
            className="timeline-btn play-btn"
            onClick={onPlayPause}
            title={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <span className="timeline-time">{formatTime(currentTime)}</span>
        </div>
        <div className="timeline-actions">
          <button
            className="timeline-btn branch-btn"
            onClick={() => onCreateBranch(currentTime)}
            title="从当前时间点创建分支"
          >
            🌿 从这里叉出新分支
          </button>
        </div>
      </div>

      <div
        ref={sliderRef}
        className="timeline-slider"
        onMouseDown={handleMouseDown}
      >
        <div className="timeline-track">
          <div
            className="timeline-progress"
            style={{ width: `${progress}%` }}
          />
        </div>

        {events.map((event, index) => {
          const position = ((event.timestamp - startTime) / totalDuration) * 100;
          return (
            <div
              key={index}
              className="timeline-event-marker"
              style={{
                left: `${position}%`,
                backgroundColor: getEventColor(event.type),
              }}
              onMouseEnter={() => setHoveredEvent(event)}
              onMouseLeave={() => setHoveredEvent(null)}
              onClick={(e) => {
                e.stopPropagation();
                onTimeChange(event.timestamp);
              }}
            />
          );
        })}

        <div
          className="timeline-thumb"
          style={{ left: `${progress}%` }}
        />
      </div>

      {hoveredEvent && (
        <div
          className="timeline-tooltip"
          style={{
            left: `${((hoveredEvent.timestamp - startTime) / totalDuration) * 100}%`,
          }}
        >
          <div className="tooltip-time">{formatTime(hoveredEvent.timestamp)}</div>
          <div className="tooltip-desc">{hoveredEvent.description}</div>
        </div>
      )}

      <div className="timeline-labels">
        <span className="timeline-label">{formatTime(startTime)}</span>
        <span className="timeline-label">{formatTime(endTime)}</span>
      </div>
    </div>
  );
};
