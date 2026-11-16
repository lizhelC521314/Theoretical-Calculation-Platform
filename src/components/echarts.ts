/**
 * ECharts 按需注册入口
 *
 * 全量 `import * as echarts from 'echarts'` 会把所有图表类型打进首屏包（约 1MB）。
 * 这里只注册软件实际用到的图表与组件：
 *   - LineChart：敏感性与结果曲线、参数扫描
 *   - HeatmapChart：设计探索的可行域
 *   - Grid / Tooltip / VisualMap：坐标轴、提示框、分段色标
 *
 * 新增图表类型（雷达图、树图等）时，在此追加 import 与 use 注册即可。
 */
import * as echarts from 'echarts/core';
import { HeatmapChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export { echarts };
export type EChartsInstance = echarts.ECharts;
