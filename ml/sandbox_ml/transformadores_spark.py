"""El paso de Spark ML que no viene hecho: la limpieza columna por columna, adentro del Pipeline.

Es una lista de [columna, expresión de Spark SQL] que se aplica en orden (cada
una reemplaza la columna o la agrega al final). Va dentro del PipelineModel y se
guarda con él: al predecir, los datos nuevos pasan por la misma limpieza que el
entrenamiento. Lo que se aprendió con el entrenamiento (la mediana, los bordes de
los extremos, las categorías que quedan) ya está escrito en cada expresión.

El código que genera el estudio lo importa de acá; si corre fuera del sandbox,
trae una copia de esta clase.
"""
import json

from pyspark import keyword_only
from pyspark.ml import Transformer
from pyspark.ml.param import Param, Params, TypeConverters
from pyspark.ml.util import DefaultParamsReadable, DefaultParamsWritable
from pyspark.sql import functions as F


class Limpiar(Transformer, DefaultParamsReadable, DefaultParamsWritable):
    """Aplica en orden [[columna, expresión de Spark SQL], ...]: reemplaza la columna o la agrega."""

    expresiones = Param(Params._dummy(), "expresiones", "JSON: [[columna, expresión de Spark SQL], ...]",
                        typeConverter=TypeConverters.toString)

    @keyword_only
    def __init__(self, expresiones="[]"):
        super().__init__()
        self._setDefault(expresiones="[]")
        self._set(**self._input_kwargs)

    def _transform(self, df):
        for columna, expresion in json.loads(self.getOrDefault(self.expresiones)):
            df = df.withColumn(columna, F.expr(expresion))
        return df
