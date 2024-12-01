'use client'
import React, { useCallback, useMemo, useState, useImperativeHandle, forwardRef } from "react";
import ReactFlow, {
  addEdge,
  MiniMap,
  Controls,
  Background,
  ReactFlowProvider,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  Connection,
  Node,
  Edge,
  useReactFlow,
  SelectionMode,
} from "reactflow";
import "reactflow/dist/style.css";
import InputNode from "../nodes/input/input-node";
import "./canvas.css";
import CustomEdge from "../custom-edge/custom-edge";
import OutputNode from "../nodes/output/output-node";
import OpenAINode from "../nodes/openai/openai-node";
const FLOW_KEY = "FLOW";
const Canvas = forwardRef((props: any, ref:any) => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [rfInstance, setRfInstance] = useState<any>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [temperature, setTemperature] = useState(0);
  const [openAIKEY, setOpenAIKEY] = useState("");

  const nodeTypes = useMemo(() => ({ Input: InputNode, Output: OutputNode, OpenAI: OpenAINode }), []);
  const edgeTypes = useMemo(() => ({ CustomEdge: CustomEdge }), []);
  const defaultViewport = { x: 0, y: 0, zoom: 0.9 };

  const onNodesChange = (changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  };

  const onConnect = (connection: Connection) =>
    setEdges((eds) => 
      addEdge({...connection, type: 'CustomEdge'}, eds)
    );

  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();

    const type = event.dataTransfer.getData('text/plain');
    const position = { x: event.clientX, y: event.clientY};

    setNodes((prev) =>{
      const id = (prev.filter((p) => p.type == type).length + 1).toString();
      const llmConfig = {temperature: temperature, openAIKey: openAIKEY}
      return prev.concat({
        id: type.toLowerCase() + id,
        type: type,
        position,
        data: { 
          id: id,
          label: type.toLowerCase(), 
          value: '', 
          onDelete: deleteNode,
          showDialog: showSettingsDialog,
          llmConfig: type == "openai" ? llmConfig : {}
        },
      })

    });
  };

  const showSettingsDialog = () => {
    setShowDialog(!showDialog);
  }
  const deleteNode = (id: string) => {
    setNodes((prev) => prev.filter((node) => node.id !== id));
  };

  const onNodeDelete = (nodesToDelete: Node[]) => {
    setNodes((prev) => prev.filter((node) => 
      !nodesToDelete.some((n) => n.id === node.id)
    ));
  };

  const onSave = useCallback(() => {
    if (rfInstance) {
      const flow = rfInstance.toObject();
      localStorage.setItem(FLOW_KEY, JSON.stringify(flow));
    }
  }, [rfInstance]);

  const onRestore = useCallback(() => {
    const restoreFlow = async () => {
      const flow = JSON.parse(localStorage.getItem(FLOW_KEY) as string);
 
      if (flow) {
        const { x = 0, y = 0, zoom = 1 } = flow.viewport;
        setNodes(flow.nodes || []);
        setEdges(flow.edges || []);
      }
    };
 
    restoreFlow();
  }, [setNodes]);

  const onRun = useCallback(async () => {
    // Find connections between nodes
    const connections = edges.map(edge => ({
      source: edge.source,
      target: edge.target
    }));
  
    // Create a flow execution result
    const flowResult: any[] = [];
  
    // Update nodes state with new values based on connections
    const updatedNodes = await Promise.all(nodes.map(async (node: any) => {
      // Find if this node is a target in any connection
      const connectionToThis = connections.find(conn => conn.target === node.id);
      
      if (connectionToThis) {
        // Find the source node
        const sourceNode = nodes.find(n => n.id === connectionToThis.source);
        
        if (sourceNode) {
          // If the current node is an OpenAI node, call makeOpenAICall
          console.log(sourceNode, "source node")
          console.log(node, "node")
          if (sourceNode.type === 'OpenAI') {
            try {
              // Create a temporary node component to access makeOpenAICall
              const tempNode = {
                data: {
                  ...node.data,
                  value: sourceNode.data.value // Set the value from the source node
                },
                id: node.id
              };
  
              const OpenAINodeComponent = await import('../nodes/openai/openai-node');
              const makeOpenAICall = OpenAINodeComponent.makeOpenAICall;
              if(Object.keys(sourceNode.data.llmConfig).length == 0){
                sourceNode.data.llmConfig = {
                  temperature: temperature,
                  openAIKey: openAIKEY,
                  model: "gpt-4", // Default model or dynamic based on your dropdown
                  systemPrompt: "Your system prompt here" // Optional default
                };
              }
              // Bind the context and call the method
              const response = await makeOpenAICall({
                openAIKey: sourceNode.data.llmConfig.openAIKey || openAIKEY,
                temperature: sourceNode.data.llmConfig.temperature,
                model: sourceNode.data.llmConfig.model,
                systemPrompt: sourceNode.data.llmConfig.systemPrompt,
                value: sourceNode.data.value
              });  
              // Update the node's data with the response
              flowResult.push({
                source: sourceNode.data,
                target: node.data,
                value: response
              });
  
              return {
                ...node,
                data: {
                  ...node.data,
                  value: response
                }
              };
            } catch (error) {
              console.error('Error processing OpenAI node:', error);
              return node;
            }
          } else {
            // For non-OpenAI nodes, update value from source
            flowResult.push({
              source: sourceNode.data,
              target: node.data,
              value: sourceNode.data.value
            });
  
            return {
              ...node,
              data: {
                ...node.data,
                value: sourceNode.data.value
              }
            };
          }
        }
      }
      
      return node;
    }));
  
    // Update nodes state
    setNodes(updatedNodes);
  
    console.log('Flow Execution Result:', flowResult);
    return flowResult;
  }, [nodes, edges]);


  useImperativeHandle(ref, () => ({
    onSave,
    onRestore,
    onRun
  }));

  return (
    <ReactFlowProvider>
      <div
        style={{ width: "100%", height: "95vh", background: "#fff" }}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <ReactFlow
          nodeTypes={nodeTypes}
          nodes={nodes}
          edges={edges}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodeDelete}
          onInit={setRfInstance}
          defaultViewport={defaultViewport}
        >
          <Controls />
          <Background />
        </ReactFlow>
      </div>
      {showDialog && (
        <div className="dialog">
          <div className="header">
            <h2>OpenAI</h2>
            <div>
              <button className="close" onClick={()=>setShowDialog(false)}>×</button>
            </div>
          </div>
          <div className="content">
            <div className="field">
              <label>Provider</label>
              <div className="input-group">
                <span className="icon">🔗</span>
                <span>OpenAI</span>
              </div>
            </div>
            <div className="field">
              <label>Model</label>
              <div className="input-group">
              <select>
                <option>GPT-4o</option>
                <option>GPT-4o Mini</option>
              </select>
              <span className="badge">Fastest</span>
              </div>
            </div>
            <div className="field">
              <label>Temperature</label>
              <div className="input-group">
                <input value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} type="range" min="0" max="1" step="0.1" />
                <span>{temperature}</span>
              </div>
            </div>
            <div className="field">
              <label>API Key</label>
              <input type="text" value={openAIKEY} onChange={(e)=> setOpenAIKEY(e.target.value)} />
            </div>
          </div>
        </div>
      )}
    </ReactFlowProvider>
  );
});

Canvas.displayName = 'Canvas';
export default Canvas;